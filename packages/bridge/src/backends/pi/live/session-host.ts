/**
 * One session this bridge hosts: its runtime, live state, run, queue, settings and asks, alive while an
 * `OpenSession` is attached or work is in flight (contract README §5, rule 3), whatever the views do.
 */

import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import {
	type ActionResult,
	type AgentEvent,
	type BackendCallResult,
	emptySnapshot,
	MAX_LIST_ITEMS,
	type NoticeEvent,
	type Rejected,
	type RunShellOp,
	type SessionControl,
	type SessionSink,
	type SessionSnapshot,
	type SessionSummary,
} from "../../../contract";
import { errorText } from "../error-text";
import { permissionsSetting } from "../modes";
import type { AskHost, LiveRow } from "../ports";
import { ACCEPTED, CLOSED, rejected } from "../rejections";
import { InteractionDesk } from "../ui/interactions";
import { createRemoteUiContext } from "../ui/ui-context";
import { ChildFeeds } from "./child-feeds";
import { CommandScope } from "./command-scope";
import { requestCompaction } from "./compaction-request";
import { EventBridge } from "./event-bridge";
import type { ExtensionBinding } from "./extension-binding";
import { extensionBindings } from "./host-bindings";
import type { HostEnvironment, HostStart } from "./host-environment";
import { HostLiveState } from "./host-live-state";
import { HostRow } from "./host-row";
import { startHostRuntime } from "./host-startup";
import { type HostedFacts, liveRowOf } from "./host-summary";
import { faultEvent, noticeEvent } from "./live-notes";
import { PromptDesk } from "./prompt-desk";
import { QueueMirror } from "./queue-mirror";
import { returnQueuedInput } from "./queue-return";
import { RunTracker } from "./run-tracker";
import { SessionSettings } from "./settings";
import { ShellRun } from "./shell-run";
import { ABORT_DEADLINE_MS, BINDING_WAIT_MS, boundedAbort, shutdownRuntime, within } from "./shutdown";
import { UsageFeed } from "./usage-feed";

/** `SessionControl` with the one method a session this bridge made always has. */
type HostControl = Omit<SessionControl, "compact"> & {
	compact(instructions: string | undefined): Promise<ActionResult>;
};

const BINDING: Rejected = rejected("busy", "the session's extensions are still starting");

export class SessionHost {
	readonly sessionId: string;
	readonly live: HostLiveState;
	private readonly listRow: HostRow;
	private readonly settings: SessionSettings;
	private readonly interactions: InteractionDesk;
	private readonly runs: RunTracker;
	private readonly queue: QueueMirror;
	private readonly shell: ShellRun;
	readonly children: ChildFeeds;
	private readonly prompts: PromptDesk;
	private readonly events: EventBridge;
	private readonly askHost: AskHost;
	private readonly usage: UsageFeed;
	private readonly commands = new CommandScope();
	private runtime: AgentSessionRuntime | undefined;
	private binding: ExtensionBinding | undefined;
	private sink: SessionSink | undefined;
	/** Notices from before the session opened, which no view could see yet; they follow the open. */
	private held: NoticeEvent[] = [];
	private ready = false;
	private finished = false;
	private shuttingDown = false;
	private idleWork = 0;

	constructor(
		private readonly env: HostEnvironment,
		private readonly start: HostStart,
	) {
		this.sessionId = start.facts.sessionId;
		const { now } = env;
		const session = () => this.session;
		this.live = new HostLiveState(
			{ ...emptySnapshot(), modes: [permissionsSetting(start.permissions.mode)] },
			now,
			(event) => this.emitted(event),
		);
		this.listRow = new HostRow(start.facts, this.live, env.catalog);
		this.usage = new UsageFeed(session, this.live);
		this.settings = new SessionSettings(
			{ session, live: this.live, models: env.models, modelSwitched: () => this.usage.refresh() },
			start.permissions,
		);
		this.askHost = {
			live: this.live,
			activeRun: () => this.runs.current() ?? this.prompts.startEarly(),
			inCommand: () => this.commands.active,
			abortRun: () => this.abortInBackground(),
			now,
		};
		this.interactions = new InteractionDesk(this.askHost);
		this.runs = new RunTracker({
			live: this.live,
			interactions: this.interactions,
			refreshUsage: () => this.usage.refresh(),
		});
		this.queue = new QueueMirror(this.live);
		this.shell = new ShellRun({
			session: () => this.session,
			live: this.live,
			runs: this.runs,
			idle: () => this.idle(),
		});
		this.prompts = new PromptDesk({
			session,
			runs: this.runs,
			queue: this.queue,
			live: this.live,
			abort: () => this.abortInBackground(),
			commands: this.commands,
		});
		this.children = new ChildFeeds({
			parent: () => this.summary(),
			now,
			announce: (summary) => env.catalog.emit({ type: "session_updated", summary }),
		});
		this.events = new EventBridge({
			children: this.children,
			live: this.live,
			runs: this.runs,
			queue: this.queue,
			prompts: this.prompts,
			usage: this.usage,
			now,
			hooks: {
				userMessage: (text) => this.listRow.userMessage(text),
				renamed: (name) => this.listRow.renamed(name),
				thinkingChanged: () => this.settings.followSession(),
				settling: () => this.settings.reconcile(),
			},
		});
	}

	get session(): AgentSession {
		if (!this.runtime) throw new Error("the session host has no runtime yet");
		return this.runtime.session;
	}

	/**
	 * Builds the runtime and binds its extensions (`host-startup.ts`). Resolves once the binding ends, or as soon as a
	 * `session_start` handler asks a human; rejects when the start failed, took too long, or the host ended meanwhile.
	 */
	async begin(): Promise<void> {
		await startHostRuntime({
			shared: this.env.shared,
			start: this.start,
			interactions: this.interactions,
			askHost: this.askHost,
			gate: this.settings,
			ended: () => this.finished,
			started: (runtime, notices) => {
				this.runtime = runtime;
				for (const notice of this.env.notices.fresh(this.sessionId, notices)) this.live.emit(notice);
				this.settings.reconcile();
				this.usage.refresh();
				this.events.attach(runtime.session);
			},
			binding: (binding) => {
				this.binding = binding;
			},
			bind: (session) => this.bindings(session),
			bindingFailedLate: (error) => this.fault(error),
			bindingEnded: () => this.reviewIdle(),
		});
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

	/** Every extension's `session_start` handler has returned. */
	get bound(): boolean {
		return this.binding !== undefined && !this.binding.pending;
	}

	get ended(): boolean {
		return this.shuttingDown;
	}

	get cwd(): string {
		return this.start.cwd;
	}

	/** The session's file: a hosted session is always a persisted one. */
	get file(): string {
		const file = this.session.sessionManager.getSessionFile();
		if (file === undefined) throw new Error("a hosted session has no file");
		return file;
	}

	attach(sink: SessionSink): SessionSnapshot {
		this.sink = sink;
		return this.live.attach(sink);
	}

	detach(sink: SessionSink): void {
		this.live.detach(sink);
		if (this.sink === sink) this.sink = undefined;
	}

	/** No run, ask, compaction, retry, queued input or extension still starting: the host may end once no view is attached. */
	idle(): boolean {
		const snapshot = this.live.snapshot();
		return (
			this.runs.current() === undefined &&
			!this.prompts.isDeciding &&
			!this.binding?.pending &&
			snapshot.interactions.length === 0 &&
			snapshot.queue.length === 0 &&
			snapshot.compaction === undefined &&
			snapshot.retry === undefined &&
			this.session.isIdle
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

	/**
	 * The control every view of this host shares; it takes the session lock for what D2 lists. What reaches Pi waits
	 * for the extensions to start, as a terminal takes no input before then: until they have, it is `busy`.
	 */
	get control(): HostControl {
		return {
			prompt: (input) => this.whenBound(() => this.prompts.prompt(input)),
			abort: () => this.abort(),
			answer: async (answer) => (this.ended ? CLOSED : this.interactions.answer(answer)),
			setModel: (modelId) => this.whenBound(() => this.settings.setModel(modelId)),
			setThinking: (value) => this.whenBound(async () => this.settings.setThinking(value)),
			setMode: (axis, value) => this.locked(async () => this.settings.setMode(axis, value)),
			compact: (instructions) =>
				this.whenBound(() =>
					requestCompaction(this.session, instructions, {
						running: this.runs.current() !== undefined,
						started: () => this.events.nextCompactionStart(),
					}),
				),
		};
	}

	/** `!command` (`run_shell`), under the lock and once the extensions have started. */
	readonly runShell = (op: RunShellOp): Promise<BackendCallResult> => this.whenBound(() => this.shell.start(op));

	/** Work the registry runs on the idle session under the lock (a tree navigation): a Stop reaches it, as it reaches Pi's own (pi `src/core/agent-session.ts:2498-2508`). */
	async runIdleWork<T>(work: (session: AgentSession) => Promise<T>): Promise<T> {
		this.idleWork++;
		try {
			return await work(this.session);
		} finally {
			this.idleWork--;
		}
	}

	/** A new session asked to start at a thinking level before its model was known (`NewSessionOptions.thinking` without a model). */
	applyThinking(value: string): ActionResult {
		return this.settings.setThinking(value);
	}

	/** A hosted rename (D2: under the lock, by the registry) of a name `sessionName` checked; Pi announces it as `session_info_changed`. */
	rename(name: string): ActionResult {
		try {
			this.session.setSessionName(name);
		} catch (error) {
			return rejected("backend_error", `the session could not be renamed: ${errorText(error)}`);
		}
		return ACCEPTED;
	}

	/** Breaks what could keep the session lock held: a prompt waiting on Pi, an ask nobody can answer any more. */
	requestShutdown(): void {
		this.shuttingDown = true;
		this.prompts.close();
		this.interactions.expireAll();
	}

	/**
	 * Bridge shutdown (D17), the end of an idle host, or a start that failed: the extensions' start is let finish
	 * (its asks are expired), the run is aborted and settled, then the runtime is disposed, all within
	 * `HOST_END_BUDGET_MS` (`shutdown.ts`).
	 */
	async finish(): Promise<void> {
		if (this.finished) return;
		this.finished = true;
		this.requestShutdown();
		this.env.forget(this);
		if (this.binding?.pending) await within(this.binding.done, BINDING_WAIT_MS, undefined);
		if (this.runtime) await shutdownRuntime(this.runtime);
		if (this.sink) this.detach(this.sink);
	}

	private bindings(session: AgentSession): Parameters<AgentSession["bindExtensions"]>[0] {
		return extensionBindings({
			uiContext: createRemoteUiContext(this.interactions, this.live),
			session: () => session,
			abort: () => this.abortInBackground(),
			report: (error) => this.live.emit(noticeEvent("error", `${error.extensionPath} ${error.event}: ${error.error}`)),
		});
	}

	private locked<T>(work: () => Promise<T>): Promise<T | Rejected> {
		return this.env.locks.run(this.sessionId, async () => (this.shuttingDown ? CLOSED : work()));
	}

	private whenBound<T>(work: () => Promise<T>): Promise<T | Rejected> {
		return this.locked(async () => (this.binding?.pending ? BINDING : work()));
	}

	/** Not under the lock: an abort must reach Pi while a prompt waits on it (D2). */
	private async abort(): Promise<ActionResult> {
		if (this.ended) return CLOSED;
		if (this.shell.stop()) return ACCEPTED;
		const quiet = this.runs.current() === undefined && !this.prompts.isDeciding;
		if (quiet && this.idleWork === 0 && this.live.snapshot().compaction === undefined) return ACCEPTED;
		return this.abortNow();
	}

	/**
	 * Stops what runs, as Esc does in the terminal (pi `src/modes/interactive/interactive-mode.ts:4711-4725`): while a
	 * run is on, the steering and follow-up input queued behind it leaves Pi's queue before the abort, and goes back to
	 * the person as `input_returned`, steering first, so nothing queued is sent by a run that was stopped.
	 */
	private async abortNow(): Promise<ActionResult> {
		returnQueuedInput(this.session, this.live);
		const run = this.runs.current();
		if (run) {
			this.runs.noteAbort();
			this.interactions.withdrawRun(run.runId);
		} else {
			this.prompts.noteAbort();
		}
		try {
			await boundedAbort(this.session, ABORT_DEADLINE_MS);
		} catch (error) {
			return rejected("backend_error", `the abort failed: ${errorText(error)}`);
		}
		return ACCEPTED;
	}

	private abortInBackground(): void {
		void this.abortNow().then((result) => {
			if (result.status === "rejected") this.fault(result.rejection.message);
		});
	}

	/** Every event a part of the session emits passes here: the row follows it, and an idle host may end. */
	private emitted(event: AgentEvent): void {
		if (this.binding?.pending && this.live.snapshot().interactions.length > 0) this.binding.noteAsk();
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

	private fault(error: unknown): void {
		this.live.emit(faultEvent(error));
	}
}
