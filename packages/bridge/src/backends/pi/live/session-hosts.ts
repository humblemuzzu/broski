/**
 * The sessions this bridge hosts, by id: open (existing or new), the session lock, the live facts the store lays over
 * its rows, the writes a hosted session must take, and shutdown. A hosted session is one `pi --mode rpc` kept by a
 * holder process (`holder/`), which outlives the bridge: at start the bridge takes over every holder an earlier bridge
 * left (`adopting`), and a shutdown with work under way lets go of the holder instead of ending it.
 */

import { errorText } from "../../../adapter-kit/error-text";
import { CLOSED, rejected } from "../../../adapter-kit/rejections";
import type {
	ActionResult,
	OpenResult,
	OpenTarget,
	Rejected,
	SessionId,
	SessionSink,
	SessionSummary,
} from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import type { HolderSetup } from "../holder/link";
import { type ChildSessionPart, parseChildSessionId } from "../ids";
import { isDirectory } from "../is-directory";
import type { ModelCatalogue } from "../models/catalogue";
import type { PiInstall } from "../pi-install";
import type { LiveOverlay, LiveRow, SessionStore, StoredSession } from "../ports";
import { sessionName } from "../session-name";
import type { TerminalRegistry } from "../terminal/registry";
import { BusyReport } from "./busy-report";
import { defaultHostedSessions, makeRoom } from "./host-capacity";
import type { HostEnvironment, HostStart } from "./host-environment";
import { adoptedStart, adoptLeftHolders, attachHolder, launchedStart, type Target } from "./host-starts";
import { factsOf } from "./hosted-session";
import type { LiveImageCache } from "./image-cache";
import { type NewSessionRegistry, openNewSession } from "./open-new";
import { openSessionView } from "./open-session";
import { RECONNECTING, reattachLost } from "./reattach";
import { SessionHost } from "./session-host";
import { SessionLocks } from "./session-lock";
import { type HostedPart, rereadSession, SessionView, type SessionViewDeps, type ViewStart } from "./session-view";

export interface SessionHostsDeps {
	readonly install: PiInstall;
	/** Where the bridge's extension is written for the `pi` processes it starts (`host/install.ts`). */
	readonly hostDir: string;
	readonly holders: HolderSetup;
	readonly terminals: TerminalRegistry;
	readonly models: Pick<ModelCatalogue, "find" | "missing" | "starting">;
	readonly store: SessionStore;
	readonly catalog: CatalogFeed;
	readonly now: () => number;
	/** How many `pi` processes may be hosted at once; `defaultHostedSessions()` when not given. */
	readonly maxHosted?: number;
	/** `isBusy(sessionId)` changed, for a terminal that has the session open (`terminal/`). */
	readonly busyChanged?: (sessionId: SessionId, busy: boolean) => void;
	readonly images?: LiveImageCache;
}

/** A hosted session's write, or the store's when nobody hosts it; both under the session lock. */
export type StoredWrite = (name: string) => Promise<ActionResult>;

export class SessionHosts implements LiveOverlay {
	private readonly hosts = new Map<SessionId, SessionHost>();
	/**
	 * Hosts that lost their holder's socket while `pi` ran on, by session, until the holder is taken over again or that
	 * fails (`reattach.ts`). They are out of `hosts`, so nothing reaches them as a running host, but they still show the
	 * session as busy and keep its file from other writers.
	 */
	private readonly reattaching = new Map<SessionId, SessionHost>();
	/** The views the core holds now, by session. */
	private readonly views = new Map<SessionId, SessionView>();
	private readonly busy: BusyReport;
	private readonly locks = new SessionLocks();
	private readonly env: HostEnvironment;
	private disposing: Promise<void> | undefined;
	/**
	 * The holders an earlier bridge left, being taken over. Every open waits for it before it takes a session's lock, so
	 * it never starts a second `pi` on a session a holder runs (and never holds a lock the adoption waits on).
	 */
	private readonly adopting: Promise<void>;

	constructor(private readonly deps: SessionHostsDeps) {
		this.busy = new BusyReport((sessionId) => this.isBusy(sessionId), deps.busyChanged);
		this.env = {
			models: deps.models,
			catalog: deps.catalog,
			locks: this.locks,
			now: deps.now,
			idle: (host) => this.endWhenIdle(host),
			forget: (host) => {
				if (this.hosts.get(host.sessionId) === host) this.hosts.delete(host.sessionId);
				this.busy.review(host.sessionId);
			},
			lost: (host) => this.reattach(host),
			changed: (host) => {
				this.busy.review(host.sessionId);
				this.views.get(host.sessionId)?.hostChanged();
			},
			...(deps.images !== undefined && { images: deps.images }),
		};
		this.adopting = adoptLeftHolders(deps.holders.root, (meta) => {
			deps.store.sessionDirFor(meta.cwd);
			return this.adoptAgain(meta.sessionId);
		});
	}

	/** Once the holders an earlier bridge left are taken over: a read before then would show their runs as unknown. */
	adopted(): Promise<void> {
		return this.adopting;
	}

	async open(target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
		await this.adopting;
		return target.kind === "new"
			? openNewSession(this.newSessions(), target.options, sink)
			: this.locks.run(target.session.sessionId, () => this.openExisting(target.session.sessionId, sink));
	}

	/** Under the lock, with one check of the title for both: a hosted session is renamed by its `pi`, any other by the store. */
	rename(sessionId: SessionId, title: string, stored: StoredWrite): Promise<ActionResult> {
		const name = sessionName(title);
		if (typeof name !== "string") return Promise.resolve(name);
		return this.locks.run(sessionId, async () => {
			if (this.reattaching.has(sessionId)) return RECONNECTING;
			const host = this.hosts.get(sessionId);
			return host && !host.ended ? host.rename(name) : stored(name);
		});
	}

	/** `busy` while the session has work in flight; the store ends an idle host once the file may be deleted. */
	remove(sessionId: SessionId, stored: (release: () => Promise<void>) => Promise<ActionResult>): Promise<ActionResult> {
		return this.locks.run(sessionId, async () => {
			if (this.reattaching.has(sessionId)) return RECONNECTING;
			const host = this.hosts.get(sessionId);
			if (host?.ended) return CLOSED;
			if (host && !host.idle()) return rejected("busy", "the session has work under way");
			return stored(async () => {
				await host?.finish();
			});
		});
	}

	/** A hosted session's child that its tool call is running, or has run in this host's life: a view that follows it. */
	openChild(part: ChildSessionPart, sink: SessionSink): OpenResult | undefined {
		return this.shown(part.parentId)?.children.open(part.piToolCallId, sink);
	}

	unwritten(parentId: SessionId): readonly SessionSummary[] {
		return this.shown(parentId)?.children.unwritten() ?? [];
	}

	row(sessionId: SessionId): LiveRow | undefined {
		const child = parseChildSessionId(sessionId);
		if (child !== undefined) return this.shown(child.parentId)?.children.row(sessionId);
		return this.shown(sessionId)?.row() ?? this.deps.terminals.row(sessionId);
	}

	/** The host whose state is the session's as far as this bridge knows: the running one, or the one reconnecting. */
	private shown(sessionId: SessionId): SessionHost | undefined {
		return this.hosts.get(sessionId) ?? this.reattaching.get(sessionId);
	}

	/**
	 * This bridge runs the session and has something in flight in it, so a terminal that opens it is told not to type in
	 * it. An idle host gives way to the terminal instead (`SessionView`).
	 */
	isBusy(sessionId: SessionId): boolean {
		if (this.reattaching.has(sessionId)) return true;
		const host = this.hosts.get(sessionId);
		return host !== undefined && !host.ended && !host.idle();
	}

	/** A running host of a session in `cwd`, whose `pi` loaded what a new session there would load. */
	inDirectory(cwd: string): SessionHost | undefined {
		for (const host of this.hosts.values()) if (host.isReady && !host.ended && host.cwd === cwd) return host;
		return undefined;
	}

	host(sessionId: SessionId): SessionHost | undefined {
		const host = this.hosts.get(sessionId);
		return host?.isReady && !host.ended ? host : undefined;
	}

	/**
	 * Every host ends at once, without waiting for the session lock: a lock holder may be waiting on Pi. A host with work
	 * under way is let go instead, its holder keeping it for the next bridge.
	 */
	dispose(): Promise<void> {
		const hosts = [...this.hosts.values()];
		this.disposing ??= Promise.all(hosts.map((host) => (host.worthKeeping ? host.release() : host.finish()))).then(() =>
			Promise.all([...this.views.values()].map((view) => view.close())).then(() => undefined),
		);
		return this.disposing;
	}

	private newSessions(): NewSessionRegistry {
		const { models, store, now, catalog } = this.deps;
		return {
			models,
			store,
			now,
			locks: this.locks,
			start: (target, permissions, facts) => this.startHost(target, permissions, facts),
			attach: (host, sink) => {
				const opened = this.attachNew(host, sink);
				catalog.emit({ type: "session_updated", summary: host.summary() });
				return opened;
			},
		};
	}

	private async openExisting(sessionId: SessionId, sink: SessionSink): Promise<OpenResult> {
		if (this.disposing) return CLOSED;
		const existing = this.hosts.get(sessionId);
		if (existing) return existing.ended ? CLOSED : this.viewOf(existing, sink);
		const stored = await this.deps.store.locate(sessionId);
		if ("status" in stored) return stored;
		const hostable = stored.cwd !== undefined && isDirectory(stored.cwd);
		const heldByTerminal = this.deps.terminals.holder(stored.path) !== undefined;
		if (heldByTerminal || !hostable || stored.origin === "external") {
			const { snapshot, hostable: canHost } = await rereadSession(stored.sessionId, this.deps.store);
			const view = this.register(stored.sessionId, stored.path, sink, {
				kind: canHost ? "dormant" : "watching",
				snapshot,
			});
			return { status: "accepted", session: view, snapshot: view.snapshot() };
		}
		const host = await this.hostStored(stored);
		return "status" in host ? host : this.attachNew(host, sink);
	}

	private register(sessionId: SessionId, path: string, sink: SessionSink, start: ViewStart): SessionView {
		const deps: SessionViewDeps = {
			sessionId,
			path,
			terminals: this.deps.terminals,
			models: this.deps.models,
			...(this.deps.images !== undefined && { images: this.deps.images }),
			reread: () => rereadSession(sessionId, this.deps.store),
			revive: async (viewSink) => {
				await this.adopting;
				return this.locks.run(sessionId, () => this.revive(sessionId, viewSink));
			},
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
		return {
			view: openSessionView(host, sink, () => this.endWhenIdle(host)),
			idle: () => host.idle(),
			ended: () => host.ended,
		};
	}

	/** A view whose host's `pi` exited is run by a new one when the phone acts in it again; one whose session is gone is closed. */
	private async revive(sessionId: SessionId, sink: SessionSink): Promise<HostedPart | Rejected> {
		if (this.disposing) return CLOSED;
		const existing = this.hosts.get(sessionId);
		if (existing && !existing.ended) return this.partOf(existing, sink);
		const stored = await this.deps.store.locate(sessionId);
		if ("status" in stored) return stored.rejection.code === "not_found" ? CLOSED : stored;
		if (this.deps.terminals.holder(stored.path) !== undefined) {
			return rejected("busy", "A terminal just opened this session; try again.");
		}
		const host = await this.hostStored(stored);
		if ("status" in host) return host;
		const part = this.partOf(host, sink);
		host.markReady();
		return part;
	}

	private async hostStored(stored: StoredSession): Promise<SessionHost | Rejected> {
		const { cwd } = stored;
		if (cwd === undefined) return rejected("not_found", "the session records no working directory");
		if (!isDirectory(cwd)) return rejected("not_found", `the session's working directory ${cwd} no longer exists`);
		const facts = await this.deps.store.facts(stored);
		if ("status" in facts) return facts;
		const target: Target = { sessionId: stored.sessionId, cwd, file: stored.path, lastEntryId: facts.lastEntryId };
		return this.startHost(target, facts.permissions, factsOf(stored, cwd, facts, this.deps.now()));
	}

	/**
	 * Under the session lock: a holder already running the session is taken over, never doubled. Otherwise a new one
	 * starts, after room is made for it. The host is registered before its `pi` has started, so a shutdown reaches it.
	 */
	private async startHost(
		target: Target,
		permissions: HostStart["permissions"],
		facts: HostStart["facts"],
	): Promise<SessionHost | Rejected> {
		if (this.disposing) return CLOSED;
		const adopted = await this.adoptHolder(target.sessionId);
		if (adopted !== undefined) return adopted;
		if (!this.deps.install.cli.found) return rejected("backend_error", this.deps.install.cli.reason);
		const crowded = await makeRoom(this.hosts, this.locks, this.deps.maxHosted ?? defaultHostedSessions());
		if (crowded !== undefined) return crowded;
		if (this.disposing) return CLOSED;
		const start = await launchedStart(this.deps, target, { permissions, facts });
		if ("status" in start) return start;
		return this.begun(new SessionHost(this.env, start), "launched");
	}

	/**
	 * A `pi` this bridge launched that fails to start is stopped. One it was taking over from its holder is let go, never
	 * stopped: its run goes on, and the holder is there to be taken over again (`busy`, worth another try).
	 */
	private async begun(host: SessionHost, how: "launched" | "adopted"): Promise<SessionHost | Rejected> {
		this.hosts.set(host.sessionId, host);
		try {
			await (how === "launched" ? host.begin() : host.adopt());
		} catch (error) {
			if (this.disposing) return CLOSED;
			if (how === "launched") {
				await host.finish();
				return rejected("backend_error", `the session could not be started: ${errorText(error)}`);
			}
			host.release();
			return rejected("busy", `the bridge could not take over the session's Pi: ${errorText(error)}`);
		}
		if (this.disposing || host.ended) return CLOSED;
		this.reattaching.delete(host.sessionId);
		return host;
	}

	/** A holder's session, taken over and shown in the list; its view, if it has one, follows the new host. */
	private async adoptAgain(sessionId: SessionId): Promise<void> {
		const host = await this.locks.run(sessionId, () => this.adoptAnnounced(sessionId));
		if (host !== undefined && !("status" in host)) this.views.get(sessionId)?.resume();
	}

	/** The host lost its holder's socket while `pi` ran on; until `reattachLost` settles, it stands for the session. */
	private reattach(lost: SessionHost): void {
		const { sessionId } = lost;
		this.reattaching.set(sessionId, lost);
		this.busy.review(sessionId);
		void reattachLost(lost, {
			attempt: () => this.locks.run(sessionId, () => this.adoptAnnounced(sessionId)),
			settled: () => {
				if (this.reattaching.get(sessionId) === lost) this.reattaching.delete(sessionId);
				this.busy.review(sessionId);
			},
			adopted: () => this.views.get(sessionId)?.resume(),
		});
	}

	/** Under the session lock: `adoptHolder`, and a host newly taken over is ready and shown in the list. */
	private async adoptAnnounced(sessionId: SessionId): Promise<SessionHost | Rejected | undefined> {
		const host = await this.adoptHolder(sessionId);
		if (host === undefined || "status" in host || host.isReady) return host;
		host.markReady();
		this.deps.catalog.emit({ type: "session_updated", summary: host.summary() });
		return host;
	}

	/** Under the session lock: the host this bridge has, else the session's holder taken over, else undefined. */
	private async adoptHolder(sessionId: SessionId): Promise<SessionHost | Rejected | undefined> {
		if (this.disposing) return CLOSED;
		const existing = this.hosts.get(sessionId);
		if (existing !== undefined && !existing.ended) return existing;
		const attached = await attachHolder(this.deps.holders, sessionId);
		if (attached === undefined || "status" in attached) return attached;
		const start = this.disposing ? CLOSED : await adoptedStart(this.deps, sessionId, attached);
		if ("status" in start) {
			attached.link.detach();
			return start;
		}
		return this.begun(new SessionHost(this.env, start), "adopted");
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
			if (!host.ended && (!host.live.attached || host.retiring) && host.idle()) await host.finish();
		});
	}
}
