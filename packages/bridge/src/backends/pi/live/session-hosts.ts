/**
 * The sessions this bridge hosts, by id: open (existing or new), the session lock (D2), the live facts
 * the store lays over its rows, the writes a hosted session must take, and shutdown.
 */

import { unlink } from "node:fs/promises";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
	ActionResult,
	BackendCallResult,
	NewSessionOptions,
	OpenResult,
	OpenTarget,
	Rejected,
	RunShellOp,
	SessionId,
	SessionSink,
	SessionSnapshot,
	SessionSummary,
} from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { errorText } from "../error-text";
import { type ChildSessionPart, parseChildSessionId } from "../ids";
import { isDirectory } from "../is-directory";
import type { ModelCatalogue } from "../models/catalogue";
import { initialPermissions } from "../modes";
import type { HostAccess, LiveOverlay, LiveRow, OwnershipAccess, SessionStore, StoredSession } from "../ports";
import { ACCEPTED, CLOSED, rejected } from "../rejections";
import { sessionName } from "../session-name";
import { canonicalCwd } from "../store/session-dir";
import type { TerminalRegistry } from "../terminal/registry";
import type { HostEnvironment, HostStart } from "./host-environment";
import { factsOf, lastPermissions } from "./hosted-session";
import { createSessionFile } from "./new-session-file";
import { chooseModel } from "./new-session-options";
import { NoticeMemory } from "./notice-memory";
import { openSessionView } from "./open-session";
import type { SharedServices } from "./runtime-factory";
import { SessionHost } from "./session-host";
import { SessionLocks } from "./session-lock";
import { type HostedPart, SessionView, type SessionViewDeps, watchedSnapshot } from "./session-view";

export interface SessionHostsDeps {
	readonly terminals: TerminalRegistry;
	readonly shared: SharedServices;
	readonly models: Pick<ModelCatalogue, "find">;
	readonly store: SessionStore;
	readonly catalog: CatalogFeed;
	readonly now: () => number;
}

/** A hosted session's write, or the store's when nobody hosts it; both under the session lock. */
export type StoredWrite = (name: string) => Promise<ActionResult>;

/** A session hosted only for one op cannot show a `session_start` ask to anyone; its end expires the ask. */
const STARTING_ASKS: Rejected = rejected(
	"busy",
	"an extension asks something as the session starts: open it to answer",
);

export class SessionHosts implements LiveOverlay, HostAccess, OwnershipAccess {
	private readonly hosts = new Map<SessionId, SessionHost>();
	/** The views the core holds now, by session. */
	private readonly views = new Map<SessionId, SessionView>();
	private readonly locks = new SessionLocks();
	private readonly env: HostEnvironment;
	private disposing: Promise<void> | undefined;

	constructor(private readonly deps: SessionHostsDeps) {
		this.env = {
			shared: deps.shared,
			models: deps.models,
			catalog: deps.catalog,
			locks: this.locks,
			notices: new NoticeMemory(),
			now: deps.now,
			idle: (host) => this.endWhenIdle(host),
			forget: (host) => {
				if (this.hosts.get(host.sessionId) === host) this.hosts.delete(host.sessionId);
			},
		};
	}

	open(target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
		return target.kind === "new"
			? this.openNew(target.options, sink)
			: this.locks.run(target.session.sessionId, () => this.openExisting(target.session.sessionId, sink));
	}

	/** Under the lock, with one check of the title for both: a hosted session is renamed by its host (Pi announces it), any other by the store. */
	rename(sessionId: SessionId, title: string, stored: StoredWrite): Promise<ActionResult> {
		const name = sessionName(title);
		if (typeof name !== "string") return Promise.resolve(name);
		return this.locks.run(sessionId, async () => {
			const host = this.hosts.get(sessionId);
			return host && !host.ended ? host.rename(name) : stored(name);
		});
	}

	/** `busy` while the session has work in flight; the store ends an idle host once the file may be deleted. */
	remove(sessionId: SessionId, stored: (release: () => Promise<void>) => Promise<ActionResult>): Promise<ActionResult> {
		return this.locks.run(sessionId, async () => {
			const host = this.hosts.get(sessionId);
			if (host?.ended) return CLOSED;
			if (host && !host.idle()) return rejected("busy", "the session has work under way");
			return stored(async () => {
				await host?.finish();
			});
		});
	}

	/**
	 * Makes a session another client wrote this bridge's (`claim` writes the mark, or refuses), and hosts it: its open
	 * view, if it has one, becomes the host's. Under the session lock, with the claim, so nothing else opens or writes
	 * the session between the refusals and the mark. A session this bridge hosts already is its own.
	 */
	takeOver(sessionId: SessionId, claim: (stored: StoredSession) => Promise<ActionResult>): Promise<ActionResult> {
		return this.locks.run(sessionId, async () => {
			if (this.disposing) return CLOSED;
			if (this.hosts.has(sessionId)) return ACCEPTED;
			const before = await this.deps.store.locate(sessionId);
			if ("status" in before) return before;
			const claimed = await claim(before);
			if (claimed.status === "rejected") return claimed;
			const view = this.views.get(sessionId);
			if (view === undefined) return ACCEPTED;
			const claimedSession = await this.deps.store.locate(sessionId);
			if ("status" in claimedSession) return claimedSession;
			const host = await this.hostStored(claimedSession);
			if ("status" in host) return host;
			const part = this.partOf(host, view.sink);
			host.markReady();
			view.becomeHosted(part);
			return ACCEPTED;
		});
	}

	withIdleSession<T>(sessionId: SessionId, work: (session: AgentSession) => Promise<T>): Promise<T | Rejected> {
		return this.locks.run(sessionId, async () => {
			if (this.disposing) return CLOSED;
			const hosted = this.hosts.get(sessionId);
			if (hosted) return hosted.idle() ? hosted.runIdleWork(work) : rejected("busy", "the session has work under way");
			const stored = await this.deps.store.locate(sessionId);
			if ("status" in stored) return stored;
			if (stored.origin === "external") return rejected("unsupported", "another client made this session");
			const host = await this.hostStored(stored);
			if ("status" in host) return host;
			try {
				return host.bound ? await host.runIdleWork(work) : STARTING_ASKS;
			} finally {
				await host.finish();
			}
		});
	}

	/** `run_shell` runs in a session this bridge hosts; the phone that asks has it open, so it does. Undefined when it is not hosted. */
	runShell(op: RunShellOp): Promise<BackendCallResult> | undefined {
		const hosted = this.hosts.get(op.sessionId);
		return hosted && !hosted.ended ? hosted.runShell(op) : undefined;
	}

	/** A hosted session's child that its tool call is running, or has run in this host's life: a view that follows it. */
	openChild(part: ChildSessionPart, sink: SessionSink): OpenResult | undefined {
		return this.hosts.get(part.parentId)?.children.open(part.piToolCallId, sink);
	}

	unwritten(parentId: SessionId): readonly SessionSummary[] {
		return this.hosts.get(parentId)?.children.unwritten() ?? [];
	}

	row(sessionId: SessionId): LiveRow | undefined {
		const child = parseChildSessionId(sessionId);
		if (child !== undefined) return this.hosts.get(child.parentId)?.children.row(sessionId);
		return this.hosts.get(sessionId)?.row() ?? this.deps.terminals.row(sessionId);
	}

	/**
	 * This bridge runs the session and has something in flight in it, so a terminal that opens it is told not to type in
	 * it. An idle host gives way to the terminal instead (`SessionView`).
	 */
	isBusy(sessionId: SessionId): boolean {
		const host = this.hosts.get(sessionId);
		return host !== undefined && !host.ended && !host.idle();
	}

	/** The live session of a hosted session, for `listCommands({session})`. */
	session(sessionId: SessionId): AgentSession | undefined {
		const host = this.hosts.get(sessionId);
		return host?.isReady ? host.session : undefined;
	}

	/** A hosted session of `cwd`, whose commands are the ones a new session there would load. */
	sessionIn(cwd: string): AgentSession | undefined {
		const wanted = canonicalCwd(cwd);
		for (const host of this.hosts.values()) {
			if (host.isReady && host.bound && canonicalCwd(host.cwd) === wanted) return host.session;
		}
		return undefined;
	}

	/**
	 * Every host ends at once (D17), without waiting for the session lock: a lock holder may be waiting on Pi, which
	 * the abort in `finish()` releases, and the whole bridge has only `DEFAULT_TEARDOWN_TIMEOUT_MS` to stop.
	 */
	dispose(): Promise<void> {
		this.disposing ??= Promise.all([...this.hosts.values()].map((host) => host.finish())).then(() =>
			Promise.all([...this.views.values()].map((view) => view.close())).then(() => undefined),
		);
		return this.disposing;
	}

	private async openNew(options: NewSessionOptions, sink: SessionSink): Promise<OpenResult> {
		const chosen = await chooseModel(options, this.deps.models);
		if ("status" in chosen) return chosen;
		const permissions = initialPermissions(options.modes);
		let sessionManager: SessionManager;
		try {
			sessionManager = await createSessionFile(options.cwd, this.deps.store.sessionDirFor(options.cwd), permissions);
		} catch (error) {
			return rejected("backend_error", `the session could not be created: ${errorText(error)}`);
		}
		const now = this.deps.now();
		const sessionId = sessionManager.getSessionId();
		const start: HostStart = {
			cwd: options.cwd,
			sessionManager,
			permissions: { mode: permissions, allowedTools: [] },
			facts: { sessionId, cwd: options.cwd, createdAt: now, updatedAt: now, origin: "broski", prompted: false },
			...chosen.settings,
		};
		return this.locks.run(sessionId, async () => {
			const host = await this.startHost(start, chosen.thinkingAfterStart);
			if ("status" in host) {
				await discardUnused(sessionManager);
				return host;
			}
			const opened = this.attachNew(host, sink);
			this.deps.catalog.emit({ type: "session_updated", summary: host.summary() });
			return opened;
		});
	}

	private async openExisting(sessionId: SessionId, sink: SessionSink): Promise<OpenResult> {
		if (this.disposing) return CLOSED;
		const existing = this.hosts.get(sessionId);
		if (existing) return existing.ended ? CLOSED : this.viewOf(existing, sink);
		const stored = await this.deps.store.locate(sessionId);
		if ("status" in stored) return stored;
		const heldByTerminal = this.deps.terminals.holder(stored.path) !== undefined;
		if (heldByTerminal || stored.origin === "external" || stored.cwd === undefined || !isDirectory(stored.cwd)) {
			return this.watch(stored, sink);
		}
		const host = await this.hostStored(stored);
		return "status" in host ? host : this.attachNew(host, sink);
	}

	private async watch(stored: StoredSession, sink: SessionSink): Promise<OpenResult> {
		const view = this.register(
			stored.sessionId,
			stored.path,
			sink,
			await watchedSnapshot(stored.sessionId, this.deps.store),
		);
		return { status: "accepted", session: view, snapshot: view.snapshot() };
	}

	private register(
		sessionId: SessionId,
		path: string,
		sink: SessionSink,
		start: HostedPart | SessionSnapshot,
	): SessionView {
		const deps: SessionViewDeps = {
			sessionId,
			path,
			terminals: this.deps.terminals,
			reread: () => watchedSnapshot(sessionId, this.deps.store),
			now: this.deps.now,
			release: () => {
				if (this.views.get(sessionId) === view) this.views.delete(sessionId);
			},
		};
		const view: SessionView = new SessionView(deps, sink, start);
		this.views.set(sessionId, view);
		return view;
	}

	/** The host's side of a view of its session: events reach `sink` from now on, and a closed view lets an idle host end. */
	private partOf(host: SessionHost, sink: SessionSink): HostedPart {
		host.attach(sink);
		return { view: openSessionView(host, sink, () => this.endWhenIdle(host)), idle: () => host.idle() };
	}

	private async hostStored(stored: StoredSession): Promise<SessionHost | Rejected> {
		const { cwd } = stored;
		if (cwd === undefined) return rejected("not_found", "the session records no working directory");
		if (!isDirectory(cwd)) return rejected("not_found", `the session's working directory ${cwd} no longer exists`);
		let sessionManager: SessionManager;
		try {
			sessionManager = SessionManager.open(stored.path, this.deps.store.sessionDirFor(cwd));
		} catch (error) {
			return rejected("backend_error", `the session file could not be opened: ${errorText(error)}`);
		}
		const facts = await factsOf(stored, cwd, sessionManager, this.deps.store, this.deps.now);
		return this.startHost({ cwd, sessionManager, permissions: lastPermissions(sessionManager), facts });
	}

	/** Registers the host before it builds its runtime, so a shutdown meanwhile reaches it. */
	private async startHost(start: HostStart, thinking?: string): Promise<SessionHost | Rejected> {
		if (this.disposing) return CLOSED;
		const host = new SessionHost(this.env, start);
		this.hosts.set(host.sessionId, host);
		try {
			await host.begin();
		} catch (error) {
			await host.finish();
			return this.disposing
				? CLOSED
				: rejected("backend_error", `the session could not be started: ${errorText(error)}`);
		}
		const problem =
			this.disposing || host.ended ? CLOSED : thinking === undefined ? undefined : host.applyThinking(thinking);
		if (problem?.status === "rejected") {
			await host.finish();
			return problem;
		}
		return host;
	}

	private attachNew(host: SessionHost, sink: SessionSink): OpenResult {
		const opened = this.viewOf(host, sink);
		host.markReady();
		return opened;
	}

	private viewOf(host: SessionHost, sink: SessionSink): OpenResult {
		const view = this.register(host.sessionId, host.file, sink, this.partOf(host, sink));
		return { status: "accepted", session: view, snapshot: view.snapshot() };
	}

	/** The host is unattached and idle: it ends, after anything queued on its lock has had its turn (open, prompt). */
	private endWhenIdle(host: SessionHost): void {
		void this.locks.run(host.sessionId, async () => {
			if (!host.ended && !host.live.attached && host.idle()) await host.finish();
		});
	}
}

/**
 * A new session whose host did not start, and that holds no conversation, is left as Pi leaves such a session: with
 * no file (`createSessionFile` wrote it a moment ago, this bridge alone).
 */
async function discardUnused(manager: SessionManager): Promise<void> {
	const file = manager.getSessionFile();
	if (file === undefined || manager.getEntries().some((entry) => entry.type === "message")) return;
	await unlink(file).catch(() => undefined);
}
