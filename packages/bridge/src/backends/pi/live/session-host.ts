/**
 * One session this bridge hosts: the `pi --mode rpc` that runs it, its live state, run, queue, settings and asks,
 * alive while an `OpenSession` is attached or work is in flight (contract README §5, rule 3), whatever the views do.
 */

import {
	type ActionResult,
	type AgentEvent,
	emptySnapshot,
	MAX_LIST_ITEMS,
	type NoticeEvent,
	type Rejected,
	type SessionSink,
	type SessionSnapshot,
	type SessionSummary,
} from "../../../contract";
import { permissionsSetting } from "../modes";
import { phoneName } from "../phone-text";
import type { AskHost, LiveRow } from "../ports";
import { ACCEPTED, CLOSED, rejected } from "../rejections";
import type { PiExit } from "../rpc/child";
import type { RpcAnswer } from "../rpc/client";
import type { UiRequest } from "../rpc/frames";
import type { PiCommand, PiState } from "../rpc/replies";
import { type DialogHost, handleUiRequest } from "../ui/dialogs";
import { InteractionDesk } from "../ui/interactions";
import { ChildFeeds } from "./child-feeds";
import { requestCompaction } from "./compaction-request";
import { EntryCursor } from "./entry-cursor";
import { EventBridge } from "./event-bridge";
import { type HostControl, hostControl } from "./host-control";
import type { HostEnvironment, HostStart } from "./host-environment";
import { HostLiveState } from "./host-live-state";
import { HostRow } from "./host-row";
import { type HostedFacts, liveRowOf } from "./host-summary";
import { faultEvent } from "./live-notes";
import { PiChild } from "./pi-child";
import { PromptDesk } from "./prompt-desk";
import { QueueMirror } from "./queue-mirror";
import { returnQueuedInput } from "./queue-return";
import { RunTracker } from "./run-tracker";
import { SessionSettings } from "./settings";
import { UsageFeed } from "./usage-feed";
import { within } from "./within";

const STARTING: Rejected = rejected("busy", "the session's extensions are still starting");

/** How long an ending host lets its aborted run settle, so Pi persists what the run did, before `pi` is stopped. */
export const SETTLE_DEADLINE_MS = 1_500;

export class SessionHost {
	readonly sessionId: string;
	readonly live: HostLiveState;
	readonly children: ChildFeeds;
	private readonly child: PiChild;
	private readonly listRow: HostRow;
	private readonly settings: SessionSettings;
	private readonly interactions: InteractionDesk;
	private readonly runs: RunTracker;
	private readonly queue: QueueMirror;
	private readonly prompts: PromptDesk;
	private readonly events: EventBridge;
	private readonly usage: UsageFeed;
	private readonly askedWhileStarting = Promise.withResolvers<string>();
	private sink: SessionSink | undefined;
	/** Notices from before the session opened, which no view could see yet; they follow the open. */
	private held: NoticeEvent[] = [];
	private ready = false;
	private started = false;
	private finished = false;
	private shuttingDown = false;

	constructor(
		private readonly env: HostEnvironment,
		private readonly start: HostStart,
	) {
		this.sessionId = start.facts.sessionId;
		const { now } = env;
		this.live = new HostLiveState(
			{ ...emptySnapshot(), modes: [permissionsSetting(start.permissions.mode)] },
			now,
			(event) => this.emitted(event),
		);
		this.child = new PiChild(start.launch, (delivery) => this.events.deliver(delivery));
		const cursor = new EntryCursor(this.child, start.lastEntryId);
		this.listRow = new HostRow(start.facts, this.live, env.catalog);
		this.usage = new UsageFeed(this.child, this.live);
		this.settings = new SessionSettings(
			{
				child: this.child,
				live: this.live,
				models: env.models,
				cwd: start.cwd,
				modelSwitched: () => this.usage.refresh(),
			},
			start.permissions,
		);
		const askHost: AskHost = {
			live: this.live,
			activeRun: () => this.runs.current() ?? this.prompts.startEarly(),
			inCommand: () => this.prompts.inCommand,
			abortRun: () => this.abortInBackground(),
			aborting: () => this.runs.aborting,
			now,
		};
		this.interactions = new InteractionDesk(askHost);
		this.runs = new RunTracker({
			live: this.live,
			interactions: this.interactions,
			refreshUsage: () => this.usage.refresh(),
		});
		this.queue = new QueueMirror(this.live);
		this.prompts = new PromptDesk({
			child: this.child,
			runs: this.runs,
			queue: this.queue,
			live: this.live,
			model: () => this.settings.currentModel,
			leafId: () => cursor.leafId,
			abort: () => this.abortInBackground(),
		});
		this.children = new ChildFeeds({
			parent: () => this.summary(),
			now,
			announce: (summary) => env.catalog.emit({ type: "session_updated", summary }),
		});
		this.events = new EventBridge({
			live: this.live,
			runs: this.runs,
			queue: this.queue,
			prompts: this.prompts,
			usage: this.usage,
			cursor,
			children: this.children,
			now,
			record: (record) => void this.child.record(record),
			hooks: {
				userMessage: (text) => this.listRow.userMessage(text),
				renamed: (name) => this.listRow.renamed(name),
				thinkingChanged: (level) => this.settings.thinkingChanged(level),
				settling: () => this.settle(cursor),
				dialog: (request) => this.dialog(request),
				exited: (exit, stderr) => this.exited(exit, stderr),
			},
		});
	}

	/**
	 * Resolves once Pi has started the session (it answers its first command when every extension's `session_start`
	 * has returned); rejects when `pi` failed to start, ended meanwhile, or an extension asked a human while it started:
	 * Pi reads no answer before its extensions have started (pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:305,669`),
	 * so that ask would hold the session forever.
	 */
	async begin(): Promise<void> {
		const first = await Promise.race([this.child.started(), this.askedWhileStarting.promise]);
		if (typeof first === "string") throw new Error(first);
		if (!first.ok) throw new Error(first.error);
		await this.handshaken(first);
	}

	/** The registry has finished opening: events from now on are published, the held notices follow, and an idle host may end. */
	markReady(): void {
		this.ready = true;
		this.listRow.announceFromNow();
		const held = this.held;
		this.held = [];
		if (held.length > 0) {
			setImmediate(() => {
				if (!this.finished) for (const notice of held) this.live.emit(notice);
			});
		}
	}

	get isReady(): boolean {
		return this.ready;
	}

	get ended(): boolean {
		return this.shuttingDown;
	}

	get cwd(): string {
		return this.start.cwd;
	}

	get file(): string {
		return this.start.file;
	}

	attach(sink: SessionSink): SessionSnapshot {
		this.sink = sink;
		return this.live.attach(sink);
	}

	detach(sink: SessionSink): void {
		this.live.detach(sink);
		if (this.sink === sink) this.sink = undefined;
	}

	/** No run, ask, compaction, retry, queued input or start under way: the host may end once no view is attached. */
	idle(): boolean {
		const snapshot = this.live.snapshot();
		return (
			this.started &&
			this.runs.current() === undefined &&
			!this.prompts.isDeciding &&
			snapshot.interactions.length === 0 &&
			snapshot.queue.length === 0 &&
			snapshot.compaction === undefined &&
			snapshot.retry === undefined
		);
	}

	row(): LiveRow {
		return liveRowOf(this.live.snapshot(), this.runs.cut());
	}

	facts(): HostedFacts {
		return this.listRow.facts();
	}

	summary(): SessionSummary {
		return this.listRow.summary();
	}

	get control(): HostControl {
		return hostControl({
			ended: () => this.ended,
			whenBound: (work) => this.whenStarted(work),
			abort: () => this.abort(),
			prompt: (input) => this.prompts.prompt(input),
			compact: (instructions) => this.compact(instructions),
			interactions: this.interactions,
			settings: this.settings,
		});
	}

	/** A new session's model and level, which Pi sets once it runs (`new-session-file.ts`). */
	async applyChoice(choice: { readonly modelId?: string; readonly thinking?: string }): Promise<ActionResult> {
		const model = choice.modelId === undefined ? ACCEPTED : await this.settings.setModel(choice.modelId);
		if (model.status === "rejected" || choice.thinking === undefined) return model;
		return this.settings.setThinking(choice.thinking);
	}

	/** The commands the session's `pi` runs now. */
	commands(): Promise<RpcAnswer<readonly PiCommand[]>> {
		return this.child.commands();
	}

	/** A hosted rename of a name `sessionName` checked; Pi announces it as `session_info_changed`. */
	async rename(name: string): Promise<ActionResult> {
		const answer = await this.child.setName(name);
		return answer.ok ? ACCEPTED : rejected("backend_error", `the session could not be renamed: ${answer.error}`);
	}

	/**
	 * Bridge shutdown, the end of an idle host, or a start that failed: the asks expire, a run is aborted and let settle
	 * so Pi persists what it did, then `pi` is stopped (`rpc/child.ts`).
	 */
	async finish(): Promise<void> {
		if (this.finished) return;
		this.finished = true;
		this.shuttingDown = true;
		this.prompts.close();
		this.interactions.expireAll();
		this.env.forget(this);
		if (this.runs.current() || this.live.snapshot().compaction) {
			await within(this.child.abort(), SETTLE_DEADLINE_MS, undefined);
		}
		await this.child.stop();
		if (this.sink) this.detach(this.sink);
	}

	private async handshaken(answer: Extract<RpcAnswer<PiState>, { ok: true }>): Promise<void> {
		if (this.finished) return;
		this.settings.follow(answer.data);
		await this.usage.pull();
		this.started = true;
		this.reviewIdle();
	}

	private dialog(request: UiRequest): void {
		if (this.started || request.method === "notify") {
			void handleUiRequest(request, this.dialogHost());
			return;
		}
		this.askedWhileStarting.resolve(
			`an extension asked "${phoneName(request.title)}" while the session started, and Pi takes no answer until it has started`,
		);
	}

	private dialogHost(): DialogHost {
		return {
			live: this.live,
			desk: this.interactions,
			activeRun: () => this.runs.current() ?? this.prompts.startEarly(),
			allowedForSession: (toolName) => this.settings.allowedForSession(toolName),
			abortRun: () => this.abortInBackground(),
			answer: (id, answer) => this.child.answerDialog(id, answer),
		};
	}

	/**
	 * Before a run ends: where the session's entries stand, the totals it ends with, and what model Pi runs, which an
	 * extension may have changed.
	 */
	private async settle(cursor: EntryCursor): Promise<void> {
		const [, state] = await Promise.all([cursor.refresh(), this.child.state(), this.usage.pull()]);
		if (state.ok) this.settings.follow(state.data);
	}

	private whenStarted<T>(work: () => Promise<T>): Promise<T | Rejected> {
		return this.env.locks.run(this.sessionId, async () => {
			if (this.shuttingDown) return CLOSED;
			return this.started ? work() : STARTING;
		});
	}

	private compact(instructions: string | undefined): Promise<ActionResult> {
		const started = () => this.events.nextCompactionStart();
		const facts = {
			running: this.runs.current() !== undefined,
			hasModel: this.settings.currentModel !== undefined,
			started,
		};
		return requestCompaction(this.child, instructions, facts).then((result) => {
			if (result.status === "rejected") this.events.compactionRefused();
			return result;
		});
	}

	/** Not under the lock: an abort must reach Pi while a prompt waits on it. */
	private async abort(): Promise<ActionResult> {
		if (this.ended) return CLOSED;
		const quiet = this.runs.current() === undefined && !this.prompts.isDeciding;
		if (quiet && this.live.snapshot().compaction === undefined) return ACCEPTED;
		return this.abortNow();
	}

	/**
	 * Stops what runs, as Esc does in the terminal: the run's asks are withdrawn (Pi gets its default for each), the
	 * input queued behind the run goes back to the person, and Pi aborts (pi-coding-agent 1.5.2 `docs/rpc-commands.md:94-128`).
	 * Pi answers `abort` once the run has stopped, which a tool that ignores its signal can put off: past the deadline
	 * the abort is still accepted, and the run ends when Pi settles it.
	 */
	private async abortNow(): Promise<ActionResult> {
		const run = this.runs.current();
		if (run) {
			this.runs.noteAbort();
			this.interactions.withdrawRun(run.runId);
		} else {
			this.prompts.noteAbort();
		}
		await returnQueuedInput(this.child, this.live);
		const answer = await this.child.abort();
		if (answer.ok || this.child.running) return ACCEPTED;
		return rejected("backend_error", `the abort failed: ${answer.error}`);
	}

	private abortInBackground(): void {
		void this.abortNow().then((result) => {
			if (result.status === "rejected" && !this.finished) this.live.emit(faultEvent(result.rejection.message));
		});
	}

	/** `pi` exited: when nobody asked it to, what it ran ends with it, and so does the host. */
	private exited(exit: PiExit, stderr: string): void {
		const asked = this.finished;
		this.finished = true;
		this.shuttingDown = true;
		const how = exit.error ?? (exit.signal ? `was stopped by ${exit.signal}` : `exited with code ${exit.code}`);
		const message = `Pi ${how}${stderr === "" ? "" : `: ${stderr}`}`;
		this.events.abandonRun(
			asked ? { kind: "aborted" } : { kind: "error", error: { code: "backend_unavailable", message } },
		);
		this.prompts.close();
		this.interactions.expireAll();
		if (asked) return;
		this.live.emit(faultEvent(message));
		this.env.forget(this);
	}

	/** Every event a part of the session emits passes here: the row follows it, and an idle host may end. */
	private emitted(event: AgentEvent): void {
		if (!this.ready) {
			if (event.type === "notice" && this.held.length < MAX_LIST_ITEMS) this.held.push(event);
			return;
		}
		this.listRow.touched(this.env.now());
		this.reviewIdle();
	}

	private reviewIdle(): void {
		if (this.ready && !this.live.attached && !this.finished && this.idle()) this.env.idle(this);
	}
}
