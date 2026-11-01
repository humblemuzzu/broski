/** One hosted session: one `query()`, its inbox, its consumer, its desk and mapper, its live state (D1). */

import {
	type ActionResult,
	type AgentEvent,
	type InteractionAnswer,
	MAX_TEXT_CHARS,
	type NativeIds,
	type QueueItemId,
	type Rejected,
	type SessionControl,
	type SessionId,
	type SessionRef,
	type SessionSink,
	type SessionSnapshot,
	sessionStatus,
} from "../../../contract";
import { clip } from "../bounds";
import type { AskDesk } from "../ports/asks";
import type { LiveDeps } from "../ports/deps";
import type { BackgroundTask, HostView, SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent } from "../ports/mapping";
import type { LiveOverlay, LiveRow } from "../ports/store";
import { CLOSED, isRejected, rejected } from "../rejections";
import { abortRun, returnQueued } from "./abort";
import { ChildRouter } from "./child-router";
import { cancelCompaction, startCompaction } from "./compaction";
import { errorText } from "./error-text";
import { FrameHandler } from "./frame-handler";
import { HostEmitter } from "./host-emitter";
import { launchOptions } from "./host-launch";
import type { HostProcess } from "./host-process";
import type { HostControl, HostHooks, HostStart } from "./host-types";
import { LiveState } from "./live-state";
import { MappedRouting } from "./mapped-routing";
import { processEnded } from "./process-end";
import { ProcessSlot } from "./process-slot";
import { PromptDesk } from "./prompt-desk";
import { InputQueue } from "./queue";
import { endRun, type RunEndDeps } from "./run-end";
import { RunTracker } from "./run-tracker";
import { SerialLock } from "./serial";
import { SessionSettings } from "./settings";
import { IDLE_GRACE_MS } from "./shutdown";
import { TaskBoard } from "./task-board";

export class SessionHost {
	readonly cwd: string;
	private id: SessionId;
	private readonly state: LiveState;
	private readonly live: HostEmitter;
	private readonly runs: RunTracker;
	private readonly queue: InputQueue;
	private readonly tasks = new TaskBoard();
	private readonly children: ChildRouter;
	private readonly desk: AskDesk;
	private readonly settings: SessionSettings;
	private readonly prompts: PromptDesk;
	private readonly frames: FrameHandler;
	private readonly lock = new SerialLock();
	private readonly routing: MappedRouting;
	private readonly slot: ProcessSlot;
	private sink: SessionSink | undefined;
	private persisted: boolean;
	private finished = false;
	private cancelIdle: (() => void) | undefined;

	constructor(
		readonly deps: LiveDeps,
		private readonly overlay: LiveOverlay,
		private readonly start: HostStart,
		private readonly hooks: HostHooks,
	) {
		this.cwd = start.cwd;
		this.id = start.sessionId;
		this.persisted = start.resume;
		const now = () => deps.services.clock.now();
		this.state = new LiveState(start.snapshot, now);
		this.live = new HostEmitter(this.state, () => this.reviewIdle());
		this.runs = new RunTracker(this.live, start.tail);
		this.queue = new InputQueue(this.live);
		this.children = new ChildRouter({ parentId: () => this.id, now });
		this.routing = new MappedRouting(
			{ mapping: deps.mapping, live: this.live, runs: this.runs, children: this.children },
			this.id,
		);
		this.settings = new SessionSettings(
			{
				live: this.live,
				catalogue: deps.catalogue,
				cwd: this.cwd,
				query: () => this.slot.query,
				ensureProcess: () => this.ensureProcess(),
				locked: (work) => this.lock.run(work),
				closed: () => this.finished,
			},
			{ model: start.model },
		);
		this.slot = this.processSlot();
		this.desk = deps.createDesk({
			live: this.live,
			activeRunId: () => this.runs.activeRunId(),
			abortRun: async () => {
				await this.abort();
			},
			planModeOptions: () => this.settings.planModeOptions(),
			now,
		});
		this.prompts = this.promptDesk();
		this.frames = this.frameHandler();
	}

	get ref(): SessionRef {
		return { backend: "claude-code", sessionId: this.id };
	}

	get sessionId(): SessionId {
		return this.id;
	}

	get ended(): boolean {
		return this.finished;
	}

	get attached(): boolean {
		return this.state.attached;
	}

	get control(): HostControl {
		return {
			prompt: (input) => this.prompts.prompt(input),
			abort: () => this.abort(),
			answer: async (answer: InteractionAnswer) => (this.finished ? CLOSED : this.desk.answer(answer)),
			setModel: (modelId) => this.settings.setModel(modelId),
			setThinking: (value) => this.settings.setThinking(value),
			setMode: (axis, value) => this.settings.setMode(axis, value),
			compact: (instructions) => startCompaction(this.prompts, instructions),
			cancelCompaction: () => cancelCompaction(this.state.snapshot(), this.runs, () => this.abort(), this.finished),
			cancelQueued: async (id) => (this.finished ? CLOSED : this.queue.cancel(id)),
		};
	}

	/** Starts the CLI process for the first time; `Rejected` when it cannot start. */
	async begin(): Promise<Rejected | undefined> {
		const failure = await this.ensureProcess();
		if (!failure) this.settings.loadAxis();
		return failure;
	}

	attach(sink: SessionSink): SessionSnapshot {
		this.sink = sink;
		this.cancelIdle?.();
		this.cancelIdle = undefined;
		return this.state.attach(sink);
	}

	detach(sink: SessionSink): void {
		this.state.detach(sink);
		if (this.sink === sink) this.sink = undefined;
		this.reviewIdle();
	}

	snapshot(): SessionSnapshot {
		return this.state.snapshot();
	}

	/** No run, ask, compaction, retry or queued input: the host may end once nothing is attached. */
	idle(): boolean {
		const snapshot = this.state.snapshot();
		return (
			this.runs.current === undefined &&
			this.queue.size === 0 &&
			snapshot.interactions.length === 0 &&
			snapshot.compaction === undefined &&
			snapshot.retry === undefined
		);
	}

	row(): LiveRow {
		const snapshot = this.state.snapshot();
		const cut = this.runs.cut();
		return {
			status: sessionStatus(snapshot),
			...(snapshot.modelId !== undefined && { modelId: snapshot.modelId }),
			...(cut !== undefined && { cut }),
		};
	}

	childRow(agentId: string): LiveRow | undefined {
		return this.children.row(agentId);
	}

	openChild(agentId: string, sink: SessionSink) {
		return this.children.view(agentId, sink);
	}

	/** What an op sees of the host, or undefined while no process runs. */
	view(): HostView | undefined {
		const process = this.slot.alive;
		if (!process) return undefined;
		return {
			sessionId: this.id,
			cwd: this.cwd,
			query: process.query,
			tasks: (): readonly BackgroundTask[] => this.tasks.list(),
			busy: () => !this.idle(),
		};
	}

	/** The process, started again from the session's state when it ended; `Rejected` when it cannot start. */
	ensureProcess(): Promise<Rejected | undefined> {
		return this.slot.ensure();
	}

	/** Ends the host: asks expire, the sink goes, the process closes; nothing is emitted afterwards. */
	async finish(): Promise<void> {
		if (this.finished) return;
		this.finished = true;
		this.cancelIdle?.();
		this.cancelIdle = undefined;
		this.hooks.forget(this);
		this.desk.expireAll();
		if (this.sink) this.state.detach(this.sink);
		this.sink = undefined;
		await this.slot.end();
	}

	private abort(): Promise<ActionResult> {
		return abortRun({
			runs: this.runs,
			queue: this.queue,
			live: this.live,
			query: () => this.slot.query,
			kill: () => this.slot.close(),
			closed: () => this.finished,
		});
	}

	private processSlot(): ProcessSlot {
		return new ProcessSlot({
			sdk: this.deps.services.sdk,
			launch: () =>
				launchOptions({
					services: this.deps.services,
					cwd: this.cwd,
					sessionId: this.id,
					resume: this.persisted,
					snapshot: this.state.snapshot(),
					explicitModel: this.settings.explicitModel,
					desk: this.desk,
				}),
			finished: () => this.finished,
			frame: (message) => this.frames.handle(message),
			fault: (error) => this.fault(`a frame could not be handled: ${errorText(error)}`),
			ended: (process, error) => this.processEnded(process, error),
			initialized: (init) => this.deps.catalogue.observe(this.cwd, init),
		});
	}

	private processEnded(process: HostProcess, error: unknown): void {
		if (!this.slot.release(process) || this.finished) return;
		processEnded(
			{
				live: this.live,
				runs: this.runs,
				queue: this.queue,
				desk: this.desk,
				endRun: (outcome) => endRun(this.runEnd(), outcome),
			},
			process.isClosing,
			error,
		);
		this.reviewIdle();
	}

	private promptDesk(): PromptDesk {
		return new PromptDesk({
			live: this.live,
			runs: this.runs,
			queue: this.queue,
			ownership: this.deps.ownership,
			sessionId: () => this.id,
			noteSend: (uuid) => this.routing.current.noteSend(uuid),
			ensureProcess: () => this.ensureProcess(),
			push: (message) => this.slot.push(message),
			alive: () => this.slot.alive !== undefined,
			closed: () => this.finished,
			locked: (work) => this.lock.run(work),
			runBegan: () => this.rowChanged(),
		});
	}

	private frameHandler(): FrameHandler {
		return new FrameHandler({
			live: this.live,
			runs: this.runs,
			queue: this.queue,
			tasks: this.tasks,
			children: this.children,
			desk: this.desk,
			settings: this.settings,
			mapping: this.deps.mapping,
			mapper: () => this.routing.current,
			catalogue: this.deps.catalogue,
			cwd: this.cwd,
			emitMapped: (events) => this.routing.emit(events),
			persisted: () => {
				this.persisted = true;
			},
			systemRun: () => {
				this.runs.start("system");
				this.rowChanged();
			},
			endRun: () => endRun(this.runEnd()),
			cancelledBeforeStart: () => this.cancelledBeforeStart(),
			conversationReset: (newId) => this.conversationReset(newId),
		});
	}

	private runEnd(): RunEndDeps {
		return {
			live: this.live,
			runs: this.runs,
			queue: this.queue,
			prompts: this.prompts,
			children: this.children,
			desk: this.desk,
			mapper: () => this.routing.current,
			emitMapped: (events) => this.routing.emit(events),
			finished: () => this.rowChanged(),
		};
	}

	/** A Stop cancelled the only send of a run before the CLI began it: no `idle` is owed, so the run ends here. */
	private cancelledBeforeStart(): void {
		setImmediate(() => {
			const run = this.runs.current;
			if (!this.finished && run?.aborting && !run.started) endRun(this.runEnd());
		});
	}

	/** `/clear` and its kin: the conversation goes on under a new session id, and the old one keeps its history. */
	private conversationReset(newId: SessionId): void {
		if (newId === this.id) return;
		const previous = this.id;
		this.routing.restart(newId);
		this.id = newId;
		this.children.reset();
		this.runs.resetChain();
		this.hooks.renamed(this, previous);
		this.deps.ownership.claim(newId).catch(() => undefined);
		this.live.emit({ type: "session_replaced", session: this.ref });
	}

	private rowChanged(): void {
		const { store } = this.deps;
		try {
			store.invalidate(this.id);
			store.announce(this.id, this.overlay).catch(() => undefined);
		} catch {
			/* the row catches up at the next change */
		}
	}

	private fault(text: string): void {
		this.live.emit({
			type: "notice",
			level: "error",
			text: clip(text, MAX_TEXT_CHARS),
		});
	}

	private reviewIdle(): void {
		if (this.finished || !this.runs) return;
		const wanted = !this.state.attached && this.idle();
		if (!wanted) {
			this.cancelIdle?.();
			this.cancelIdle = undefined;
			return;
		}
		this.cancelIdle ??= this.deps.services.clock.after(IDLE_GRACE_MS, () => {
			this.cancelIdle = undefined;
			if (!this.finished && !this.state.attached && this.idle()) this.hooks.idle(this);
		});
	}
}
