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
import type { FrameHandler } from "./frame-handler";
import { HostEmitter } from "./host-emitter";
import { launchOptions } from "./host-launch";
import type { HostProcess } from "./host-process";
import type { HostControl, HostHooks, HostStart } from "./host-types";
import { frameHandlerOf, promptDeskOf, runEndOf } from "./host-wiring";
import { IdleWatch } from "./idle-watch";
import { LiveState } from "./live-state";
import { MappedRouting } from "./mapped-routing";
import { processEnded } from "./process-end";
import { ProcessSlot } from "./process-slot";
import type { PromptDesk } from "./prompt-desk";
import { InputQueue } from "./queue";
import { endRun, type RunEndDeps } from "./run-end";
import { RunTracker } from "./run-tracker";
import { SerialLock } from "./serial";
import { startNewConversation } from "./session-reset";
import { SessionSettings } from "./settings";
import { TaskBoard } from "./task-board";

export class SessionHost {
	readonly cwd: string;
	private id: SessionId;
	private readonly state: LiveState;
	readonly live: HostEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly tasks = new TaskBoard();
	readonly children: ChildRouter;
	readonly desk: AskDesk;
	readonly settings: SessionSettings;
	private readonly prompts: PromptDesk;
	private readonly frames: FrameHandler;
	readonly lock = new SerialLock();
	readonly routing: MappedRouting;
	readonly slot: ProcessSlot;
	private sink: SessionSink | undefined;
	private persisted: boolean;
	private launched = 0;
	private finished = false;
	private readonly watch: IdleWatch;

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
		this.watch = new IdleWatch(
			deps.services.clock,
			() => !this.finished && !this.state.attached && this.idle(),
			() => this.hooks.idle(this),
		);
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
		this.prompts = promptDeskOf(this);
		this.frames = frameHandlerOf(this, this.prompts);
	}

	get ref(): SessionRef {
		return { backend: "claude-code", sessionId: this.id };
	}

	get sessionId(): SessionId {
		return this.id;
	}

	markPersisted(): void {
		this.persisted = true;
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
		this.watch.stop();
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
		this.watch.stop();
		this.hooks.forget(this);
		if (this.sink) this.state.detach(this.sink);
		this.sink = undefined;
		try {
			this.desk.expireAll();
		} catch {
			/* the process closes whatever the desk says */
		}
		await this.slot.end();
	}

	/** A Stop the CLI missed because it came ahead of the message: the same Stop, once the turn is there to stop. */
	stopAgain(): void {
		void this.abort();
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
			launch: () => this.launchOptions(),
			finished: () => this.finished,
			frame: (message) => this.frames.handle(message),
			fault: (error) => this.fault(`a frame could not be handled: ${errorText(error)}`),
			ended: (process, error) => this.processEnded(process, error),
			initialized: (init) => this.deps.catalogue.observe(this.cwd, init),
		});
	}

	/** A process started again resumes a session the CLI wrote, even when no `init` was seen before it ended. */
	private async launchOptions() {
		const restart = this.launched++ > 0;
		const resume = this.persisted || (restart && (await this.onDisk()));
		return launchOptions({
			services: this.deps.services,
			cwd: this.cwd,
			sessionId: this.id,
			resume,
			snapshot: this.state.snapshot(),
			explicitModel: this.settings.explicitModel,
			desk: this.desk,
		});
	}

	private async onDisk(): Promise<boolean> {
		try {
			return !isRejected(await this.deps.store.locate(this.id));
		} catch {
			return false;
		}
	}

	private processEnded(process: HostProcess, error: unknown): void {
		if (!this.slot.release(process) || this.finished) return;
		processEnded(
			{
				live: this.live,
				runs: this.runs,
				queue: this.queue,
				desk: this.desk,
				endRun: (outcome) => endRun(runEndOf(this, this.prompts), outcome),
			},
			process.isClosing,
			error,
		);
		this.reviewIdle();
	}

	/** A Stop cancelled the only send of a run before the CLI began it: no `idle` is owed, so the run ends here. */
	cancelledBeforeStart(): void {
		setImmediate(() => {
			const run = this.runs.current;
			if (!this.finished && run?.aborting && !run.started) endRun(runEndOf(this, this.prompts));
		});
	}

	/** The conversation goes on under a new session id; the old one keeps its history. */
	conversationReset(newId: SessionId): void {
		if (newId === this.id) return;
		const previous = this.id;
		const deps = {
			routing: this.routing,
			children: this.children,
			runs: this.runs,
			ownership: this.deps.ownership,
			live: this.live,
		};
		if (!startNewConversation(deps, newId)) return;
		this.id = newId;
		this.hooks.renamed(this, previous);
		this.live.emit({ type: "session_replaced", session: this.ref });
	}

	rowChanged(): void {
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
		if (!this.finished) this.watch?.review(!this.state.attached && this.idle());
	}
}
