/**
 * The sessions this bridge hosts in `agy`, by id, all on one live front (`front.ts`). A session opens hosted when no
 * terminal `agy` holds its presence lock, watch-only when one does (`watch.ts`). Room for a new host is made by closing
 * the least recently used idle one (`cap.ts`); a host whose view closes is closed once it is idle, which frees its worker
 * and its lock for a terminal. The front's exit loses every host, and the next action starts another front.
 */

import type { FileLock, LockFile } from "../../../adapter-kit/ports";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import type {
	CatalogSink,
	NewSessionOptions,
	OpenResult,
	Rejected,
	SessionSink,
	SessionSummary,
	TranscriptItem,
} from "../../../contract";
import { AnyResult, LoadSessionResult, NewSessionResult, type SessionUpdate } from "../acp/frames";
import type { RpcFailure } from "../acp/rpc";
import type { AgyProcess } from "../agy-process";
import type { AgyCatalogs } from "../catalog/catalogs";
import type { AgyInstall } from "../install";
import { jobRoute } from "../jobs";
import type { AgySessions } from "../store/sessions";
import type { AgyTranscripts } from "../store/transcript";
import { capacityRefusal, evictionCandidate } from "./cap";
import { AgyFront } from "./front";
import { AgyHost, type HostFacts } from "./host";
import type { PhoneImages } from "./images";
import { isLockableId, POLL_MS, PresenceLocks } from "./lock";
import { AgyView } from "./view";
import { openWatched, WATCHING_NOTICE, type WatchDeps } from "./watch";

export interface HostsDeps {
	readonly install: AgyInstall;
	readonly client: { readonly name: string; readonly version: string };
	readonly fileLock: FileLock;
	readonly maxSessions: number;
	readonly images: PhoneImages;
	readonly sessions: AgySessions;
	readonly transcripts: AgyTranscripts;
	readonly catalogs: AgyCatalogs;
	readonly catalog: CatalogSink;
	readonly now: () => number;
	readonly log: (message: string) => void;
}

/** ACP's `auth_required`. */
const AUTH_REQUIRED = -32000;
/** What a load replays besides history that the live session keeps. */
const SESSION_FACTS = new Set(["usage_update", "available_commands_update", "session_info_update"]);
const REMEMBERED_CWDS = 256;

type Loaded = AgyHost | Rejected | "held";

export class AgyHosts {
	private readonly hosts = new Map<string, AgyHost>();
	private readonly closing = new Map<string, Promise<void>>();
	/** Hosts whose view closed while they had work in flight: closed once idle. */
	private readonly released = new Set<AgyHost>();
	/** Where the sessions this bridge made run: agy lists none of them before its first prompt. */
	private readonly cwds = new Map<string, string>();
	private readonly locks: PresenceLocks;
	private readonly front: AgyFront;
	private readonly shutdown = new AbortController();
	private opening = 0;

	constructor(private readonly deps: HostsDeps) {
		this.locks = new PresenceLocks(deps.install.presenceDir, deps.fileLock);
		this.front = new AgyFront(deps.install, {
			client: deps.client,
			log: deps.log,
			signal: this.shutdown.signal,
			exited: (reason) => {
				for (const host of [...this.hosts.values()]) host.lose(reason);
			},
		});
	}

	async openNew(options: NewSessionOptions, sink: SessionSink): Promise<OpenResult> {
		const made = await this.withRoom(() => this.created(options));
		return isRejected(made) ? made : this.viewOf(made, sink);
	}

	async openExisting(sessionId: string, sink: SessionSink): Promise<OpenResult> {
		if (!isLockableId(sessionId)) return rejected("not_found", `no Antigravity session ${sessionId}`);
		await this.closing.get(sessionId);
		const hosted = this.hosts.get(sessionId);
		if (hosted !== undefined && !hosted.ended) return this.viewOf(hosted, sink);
		if (!this.locks.heldElsewhere(sessionId)) {
			const host = await this.loaded(sessionId);
			if (host !== "held") return isRejected(host) ? host : this.viewOf(host, sink);
		}
		const found = await this.located(sessionId);
		return isRejected(found) ? found : openWatched(this.watchDeps(sessionId), found, sink);
	}

	/** A hosted session's row as it is now, for the list. */
	row(sessionId: string): SessionSummary | undefined {
		const host = this.hosts.get(sessionId);
		return host === undefined || host.ended ? undefined : host.summary();
	}

	host(sessionId: string): AgyHost | undefined {
		const host = this.hosts.get(sessionId);
		return host?.ended === false ? host : undefined;
	}

	/**
	 * The transcript as the phone may see it: while a run is on, it stops before the run's prompt (agy may have stored
	 * part of the run already), and the user messages this bridge sent name their images.
	 */
	shown(sessionId: string): (items: readonly TranscriptItem[]) => readonly TranscriptItem[] {
		return (items) => {
			const prompt = this.host(sessionId)?.runningPrompt;
			return this.deps.images.named(sessionId, prompt === undefined ? items : beforeRun(items, prompt));
		};
	}

	/** Every host ends, and every lock goes once the front, and with it every worker, has stopped. */
	async dispose(): Promise<void> {
		this.shutdown.abort();
		const hosts = [...this.hosts.values()];
		for (const host of hosts) host.shutDown();
		await this.front.stopped();
		await Promise.all(this.closing.values());
		for (const host of hosts) host.releaseLock();
	}

	private async created(options: NewSessionOptions): Promise<AgyHost | Rejected> {
		const front = await this.front.connection();
		if (!front.ok) return rejected("backend_error", `Antigravity could not start: ${front.failure.message}`);
		const note = this.deps.install.phoneNote;
		const params = {
			cwd: options.cwd,
			mcpServers: [],
			...(note !== undefined && { _meta: { antigravity: { systemPrompt: { append: note } } } }),
		};
		const made = await front.result.acp.rpc.request("session/new", params, NewSessionResult);
		if (!made.ok) return refusalOf("could not open a session", made.failure);
		const { sessionId } = made.result;
		const taken = isLockableId(sessionId) ? this.locks.take(sessionId) : undefined;
		const lock = taken?.kind === "taken" ? taken.lock : undefined;
		if (lock === undefined) {
			await front.result.acp.rpc.request("session/close", { sessionId }, AnyResult);
			const why = taken?.kind === "failed" ? taken.message : `agy named the session ${sessionId}, which it cannot lock`;
			return rejected("backend_error", why);
		}
		const host = this.hostOf(front.result, lock, {
			sessionId,
			cwd: options.cwd,
			origin: "broski",
			title: undefined,
			options: made.result.configOptions ?? [],
		});
		const chosen = await chosenSettings(host, options);
		if (chosen !== undefined) {
			await host.close();
			return chosen;
		}
		this.cwds.set(sessionId, options.cwd);
		for (const oldest of this.cwds.keys()) {
			if (this.cwds.size <= REMEMBERED_CWDS) break;
			this.cwds.delete(oldest);
		}
		return host;
	}

	/** The session hosted, loaded in a new host when none runs it; `held` when a terminal has it. */
	private async loaded(sessionId: string): Promise<Loaded> {
		await this.closing.get(sessionId);
		const hosted = this.host(sessionId);
		if (hosted !== undefined) return hosted;
		const found = await this.located(sessionId);
		if (isRejected(found)) return found;
		const cwd = found.cwd ?? this.cwds.get(sessionId);
		return this.withRoom<AgyHost | "held">(() => this.load(sessionId, cwd, found.title));
	}

	/** `session/load` of a session whose lock is ours; its replay is history, which the transcript reads. */
	private async load(sessionId: string, cwd: string | undefined, title: string | undefined): Promise<Loaded> {
		const taken = this.locks.take(sessionId);
		if (taken.kind !== "taken") return taken.kind === "held" ? "held" : rejected("backend_error", taken.message);
		const front = await this.front.connection();
		if (!front.ok) {
			taken.lock.release();
			return rejected("backend_error", `Antigravity could not start: ${front.failure.message}`);
		}
		const { rpc } = front.result.acp;
		const facts: SessionUpdate[] = [];
		const detach = rpc.attach(
			sessionId,
			jobRoute((update) => {
				if (SESSION_FACTS.has(update.sessionUpdate)) facts.push(update);
			}),
		);
		const params = { sessionId, cwd: cwd ?? this.deps.install.voidDir, mcpServers: [] };
		const loaded = await rpc.request("session/load", params, LoadSessionResult);
		detach();
		if (!loaded.ok) {
			taken.lock.release();
			return /not found/i.test(loaded.failure.message)
				? rejected("not_found", `no Antigravity session ${sessionId}`)
				: refusalOf("could not load the session", loaded.failure);
		}
		const options = loaded.result.configOptions ?? [];
		const origin = this.cwds.has(sessionId) ? "broski" : "external";
		const host = this.hostOf(front.result, taken.lock, { sessionId, cwd, origin, title, options });
		for (const update of facts) host.replayed(update);
		return host;
	}

	/** Room is made at once, so opens under way count against the cap; the host joins the hosts once it is open. */
	private async withRoom<T extends AgyHost | "held">(open: () => Promise<T | Rejected>): Promise<T | Rejected> {
		const room = this.makeRoom();
		if (isRejected(room)) return room;
		this.opening += 1;
		try {
			await room.done;
			if (this.shutdown.signal.aborted) return rejected("closed", "the Antigravity backend has shut down");
			const opened = await open();
			if (!(opened instanceof AgyHost)) return opened;
			if (this.shutdown.signal.aborted) {
				opened.shutDown();
				opened.releaseLock();
				return rejected("closed", "the Antigravity backend has shut down");
			}
			this.hosts.set(opened.sessionId, opened);
			return opened;
		} finally {
			this.opening -= 1;
		}
	}

	private makeRoom(): { readonly done: Promise<unknown> } | Rejected {
		const closing: Promise<void>[] = [];
		while (this.hosts.size + this.opening >= this.deps.maxSessions) {
			const victim = evictionCandidate(this.hosts.values());
			if (victim === undefined) return capacityRefusal(this.deps.maxSessions);
			closing.push(this.closeHost(victim));
		}
		return { done: Promise.all(closing) };
	}

	private closeHost(host: AgyHost): Promise<void> {
		this.forget(host);
		const done = host.close().finally(() => {
			if (this.closing.get(host.sessionId) === done) this.closing.delete(host.sessionId);
		});
		this.closing.set(host.sessionId, done);
		return done;
	}

	private hostOf(agy: AgyProcess, lock: LockFile, facts: HostFacts): AgyHost {
		return new AgyHost(
			{
				agy,
				lock,
				images: this.deps.images,
				catalog: this.deps.catalog,
				catalogChanged: (cwd) => this.deps.catalogs.invalidate(cwd),
				now: this.deps.now,
				log: this.deps.log,
				ran: (host) => {
					this.deps.sessions.invalidate();
					this.deps.transcripts.invalidate(host.sessionId);
				},
				idle: (host) => {
					if (this.released.has(host) && !host.viewed) void this.closeHost(host);
				},
				ended: (host) => this.forget(host),
			},
			facts,
		);
	}

	private viewOf(host: AgyHost, sink: SessionSink): OpenResult {
		this.released.delete(host);
		const view = new AgyView(
			{
				reopen: () => this.reopened(host.sessionId),
				closed: (closed) => this.viewClosed(closed),
				now: this.deps.now,
			},
			host,
			sink,
		);
		return { status: "accepted", session: view, snapshot: view.snapshot() };
	}

	private async reopened(sessionId: string): Promise<AgyHost | Rejected> {
		const host = await this.loaded(sessionId);
		return host === "held" ? rejected("busy", WATCHING_NOTICE) : host;
	}

	private viewClosed(host: AgyHost): void {
		if (host.ended || host.viewed) return;
		if (host.idle()) void this.closeHost(host);
		else this.released.add(host);
	}

	private forget(host: AgyHost): void {
		this.released.delete(host);
		if (this.hosts.get(host.sessionId) === host) this.hosts.delete(host.sessionId);
	}

	/** What agy lists of the session; nothing for one it lists none of (no prompt yet). */
	private async located(sessionId: string): Promise<{ cwd?: string; title?: string } | Rejected> {
		const found = await this.deps.sessions.find(sessionId);
		if (found.ok) return found.result ?? {};
		return rejected("backend_error", `Antigravity could not list its sessions: ${found.failure.message}`);
	}

	private watchDeps(sessionId: string): WatchDeps {
		return {
			ref: { backend: "antigravity", sessionId },
			terminalHolds: () => {
				const ours = this.hosts.has(sessionId) || this.closing.has(sessionId) || this.shutdown.signal.aborted;
				return ours ? undefined : this.locks.heldElsewhere(sessionId);
			},
			locate: () => this.located(sessionId),
			openHosted: async (sink) => {
				const host = await this.reopened(sessionId);
				return isRejected(host) ? host : this.viewOf(host, sink);
			},
			pollMs: POLL_MS,
			now: this.deps.now,
		};
	}
}

/** The phone's model, thinking level and modes for a new session, in that order: a model has levels of its own. */
async function chosenSettings(host: AgyHost, options: NewSessionOptions): Promise<Rejected | undefined> {
	const { modelId, thinking, modes = [] } = options;
	const choices = [
		...(modelId === undefined ? [] : [() => host.setModel(modelId)]),
		...(thinking === undefined ? [] : [() => host.setThinking(thinking)]),
		...modes.map((setting) => () => host.setMode(setting.axis, setting.value)),
	];
	for (const choose of choices) {
		const chosen = await choose();
		if (isRejected(chosen)) return chosen;
	}
	return undefined;
}

/** The items before the running prompt's own user message, when the replay already has it. */
function beforeRun(items: readonly TranscriptItem[], prompt: string): readonly TranscriptItem[] {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item?.kind !== "user_message") continue;
		return item.text.trim() === prompt.trim() ? items.slice(0, index) : items;
	}
	return items;
}

function refusalOf(what: string, failure: RpcFailure): Rejected {
	return rejected(failure.code === AUTH_REQUIRED ? "auth" : "backend_error", `Antigravity ${what}: ${failure.message}`);
}
