/**
 * One session this bridge hosts: the `pi --mode rpc` that runs it, its live state, run, queue, settings and asks,
 * alive while an `OpenSession` is attached or work is in flight (contract README §5, rule 3), whatever the views do.
 */

import type { ChildExit } from "../../../adapter-kit/stdio-child";
import {
	type ActionResult,
	type AgentEvent,
	MAX_LIST_ITEMS,
	type NoticeEvent,
	type Rejected,
	type RunOutcome,
	type SessionSink,
	type SessionSnapshot,
	type SessionSummary,
} from "../../../contract";
import type { LiveRow } from "../ports";
import { ACCEPTED, CLOSED, rejected } from "../rejections";
import type { RpcAnswer } from "../rpc/client";
import type { UiRequest } from "../rpc/frames";
import type { PiCommand, PiState } from "../rpc/replies";
import { type DialogHost, routeUiRequest } from "../ui/dialogs";
import type { InteractionDesk } from "../ui/interactions";
import type { ChildFeeds } from "./child-feeds";
import { compactHosted } from "./compaction-request";
import type { EntryCursor } from "./entry-cursor";
import type { EventBridge } from "./event-bridge";
import { type HostControl, hostControl } from "./host-control";
import type { HostEnvironment, HostStart } from "./host-environment";
import type { HostLiveState } from "./host-live-state";
import { assembleHostParts } from "./host-parts";
import type { HostRow } from "./host-row";
import { type HostedFacts, liveRowOf, quietSnapshot } from "./host-summary";
import { exitMessage, faultEvent, noticeEvent } from "./live-notes";
import type { PiChild } from "./pi-child";
import type { PromptDesk } from "./prompt-desk";
import type { QueueMirror } from "./queue-mirror";
import { RECONNECTING } from "./reattach";
import { ReplayGate } from "./replay-gate";
import { abortRun } from "./run-abort";
import type { RunTracker } from "./run-tracker";
import type { SessionSettings } from "./settings";
import type { UsageFeed } from "./usage-feed";
import { within } from "./within";

const STARTING: Rejected = rejected("busy", "the session's extensions are still starting");

const TRUNCATED =
	"This bridge restarted during a run too long to replay: the run goes on, and what it did before shows once it has ended.";

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
	private readonly cursor: EntryCursor;
	private readonly askedWhileStarting = Promise.withResolvers<string>();
	private readonly replay: ReplayGate;
	private sink: SessionSink | undefined;
	/** Notices from before the session opened, which no view could see yet; they follow the open. */
	private held: NoticeEvent[] = [];
	private ready = false;
	private started = false;
	/** `reattaching`: the holder's socket went while `pi` ran on, and the registry is taking it over again. */
	private end: "running" | "reattaching" | "ended" = "running";
	private usedAt: number;

	constructor(
		private readonly env: HostEnvironment,
		private readonly start: HostStart,
	) {
		this.sessionId = start.facts.sessionId;
		this.usedAt = env.now();
		({
			live: this.live,
			child: this.child,
			cursor: this.cursor,
			listRow: this.listRow,
			usage: this.usage,
			settings: this.settings,
			interactions: this.interactions,
			runs: this.runs,
			queue: this.queue,
			prompts: this.prompts,
			children: this.children,
			events: this.events,
		} = assembleHostParts(env, start, {
			emitted: (event) => this.emitted(event),
			abortInBackground: () => this.abortInBackground(),
			summary: () => this.summary(),
			settle: () => this.settle(),
			dialog: (request) => this.dialog(request),
			exited: (exit, stderr) => this.exited(exit, stderr),
			detached: (replaced) => this.detached(replaced),
			replaying: (replaying) => this.replay.changed(replaying),
		}));
		this.replay = new ReplayGate(this.cursor);
	}

	/**
	 * Takes over a `pi` its holder kept running: what it said since the session was last at rest is replayed first, so
	 * the run under way and its asks are this host's, and then the session is started as any other (`begin`).
	 */
	async adopt(): Promise<void> {
		const replayed = await this.replay.done(this.child.ended);
		if (!replayed) throw new Error("the session's holder went away while this bridge took it over");
		if (this.start.adoption?.truncated) this.live.emit(noticeEvent("warning", TRUNCATED));
		await this.begin();
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
				if (!this.ended) for (const notice of held) this.live.emit(notice);
			});
		}
		this.reviewIdle();
	}

	/** At bridge shutdown: `pi` has something under way its holder keeps for the next bridge. */
	get worthKeeping(): boolean {
		return this.started ? !this.idle() : this.start.adoption !== undefined;
	}

	/** Its `pi` runs another version of the bridge's extension: it ends once idle, viewed or not. */
	get retiring(): boolean {
		return this.start.adoption?.retiring === true;
	}

	get isReady(): boolean {
		return this.ready;
	}

	get ended(): boolean {
		return this.end !== "running";
	}

	get cwd(): string {
		return this.start.cwd;
	}

	get file(): string {
		return this.start.file;
	}

	/** When a view last attached or detached, or the session last did anything: the order idle hosts are ended in. */
	get lastUsedAt(): number {
		return this.usedAt;
	}

	attach(sink: SessionSink): SessionSnapshot {
		this.usedAt = this.env.now();
		this.sink = sink;
		return this.live.attach(sink);
	}

	detach(sink: SessionSink): void {
		this.usedAt = this.env.now();
		this.live.detach(sink);
		if (this.sink === sink) this.sink = undefined;
	}

	/** No run, ask, compaction, retry, queued input or start under way: the host may end once no view is attached. */
	idle(): boolean {
		return (
			this.started &&
			this.runs.current() === undefined &&
			!this.prompts.isDeciding &&
			quietSnapshot(this.live.snapshot())
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
			stopped: () => this.stopped(),
			whenBound: (work) => this.whenStarted(work),
			abort: () => this.abort(),
			prompt: (input) => this.prompts.prompt(input),
			compact: (instructions) => compactHosted(this.parts(), instructions),
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
		if (this.ended) return;
		this.end = "ended";
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
		if (this.ended) return;
		this.settings.follow(answer.data);
		// No last entry to open at (a v1 file's ids are Pi's to mint): the leaf a run's transcript is cut at is Pi's.
		if (this.start.lastEntryId === null) await this.cursor.refresh();
		await this.usage.pull();
		this.started = true;
		this.reviewIdle();
	}

	private dialog(request: UiRequest): void {
		const moment = { started: this.started, adopted: this.start.adoption !== undefined, replaying: this.replay.active };
		routeUiRequest(request, moment, this.dialogHost(), (why) => this.askedWhileStarting.resolve(why));
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
	private async settle(): Promise<void> {
		const [, state] = await Promise.all([this.cursor.refresh(), this.child.state(), this.usage.pull()]);
		if (state.ok) this.settings.follow(state.data);
	}

	private whenStarted<T>(work: () => Promise<T>): Promise<T | Rejected> {
		return this.env.locks.run(this.sessionId, async () => this.stopped() ?? (this.started ? work() : STARTING));
	}

	private stopped(): Rejected | undefined {
		if (this.end === "running") return undefined;
		return this.end === "reattaching" ? RECONNECTING : CLOSED;
	}

	/** Not under the lock: an abort must reach Pi while a prompt waits on it. */
	private async abort(): Promise<ActionResult> {
		const stopped = this.stopped();
		if (stopped !== undefined) return stopped;
		const quiet = this.runs.current() === undefined && !this.prompts.isDeciding;
		if (quiet && this.live.snapshot().compaction === undefined) return ACCEPTED;
		return this.abortNow();
	}

	private abortNow(): Promise<ActionResult> {
		return abortRun(this.parts());
	}

	private parts() {
		const { child, events, runs, settings, interactions, prompts, live } = this;
		return { child, events, runs, settings, interactions, prompts, live };
	}

	private abortInBackground(): void {
		void this.abortNow().then((result) => {
			if (result.status === "rejected" && !this.ended) this.live.emit(faultEvent(result.rejection.message));
		});
	}

	/**
	 * Bridge shutdown with work in flight: this bridge lets go, and the holder keeps `pi` running for the next bridge to
	 * take over (`holder/`). Nothing more is emitted.
	 */
	release(): void {
		if (this.ended) return;
		this.end = "ended";
		this.prompts.close();
		this.env.forget(this);
		this.child.detach();
	}

	/** `pi` exited: when nobody asked it to, what it ran ends with it, and so does the host. Its tasks went with it. */
	private exited(exit: ChildExit, stderr: string): void {
		const asked = this.ended;
		const message = exitMessage(exit, stderr);
		this.lose(asked ? { kind: "aborted" } : { kind: "error", error: { code: "backend_unavailable", message } });
		if (asked) return;
		this.live.emit(faultEvent(message));
		this.env.forget(this);
	}

	/**
	 * This bridge lost the `pi` without it ending. Another bridge took it over: what the host showed ends here. Or the
	 * holder's socket went, and `pi` runs on: the host shows what it showed, run and asks included, emits nothing more,
	 * and refuses what it is asked as `busy` while the registry takes the holder over again; the view then moves to the
	 * new host (`resynced`), or, when that fails, this host ends its run (`abandon`).
	 */
	private detached(replaced: boolean): void {
		if (this.ended) return;
		if (replaced) this.lose({ kind: "aborted" });
		else {
			this.end = "reattaching";
			this.prompts.close();
		}
		this.env.forget(this);
		if (!replaced) this.env.lost(this);
	}

	/** The registry could not take the session's holder over again: what this host showed ends, `outcome`. */
	abandon(outcome: RunOutcome): void {
		this.lose(outcome);
	}

	private lose(outcome: RunOutcome): void {
		this.end = "ended";
		this.events.abandonRun(outcome);
		if (this.live.snapshot().backgroundTasks.length > 0)
			this.live.emit({ type: "background_tasks_changed", tasks: [] });
		this.prompts.close();
		this.interactions.expireAll();
	}

	/** Every event a part of the session emits passes here: the row follows it, and an idle host may end. */
	private emitted(event: AgentEvent): void {
		this.usedAt = this.env.now();
		if (!this.ready) {
			if (event.type === "notice" && this.held.length < MAX_LIST_ITEMS) this.held.push(event);
			return;
		}
		this.listRow.touched(this.env.now());
		this.reviewIdle();
		this.env.changed(this);
	}

	private reviewIdle(): void {
		if (this.ready && (!this.live.attached || this.retiring) && !this.ended && this.idle()) this.env.idle(this);
	}
}
