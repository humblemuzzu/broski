/**
 * The sessions this bridge hosts in `agy`, by id, all on one live front (`front.ts`). A session opens hosted when no
 * terminal `agy` holds its presence lock, watch-only when one does (`watch.ts`). A host outlives its view for a grace,
 * since a reload costs agy a restart notice and a model step and holds the first prompt (`settle.ts`), then is closed
 * once idle (`unviewed.ts`), which frees its worker and its lock for a terminal; room is made sooner by closing the
 * least recently used idle one (`cap.ts`). The front's exit loses every host, and the next action starts another
 * front. A session the bridge made that agy never stored is made again in its place.
 */

import type { Clock } from "../../../adapter-kit/clock";
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
import { AnyResult, AUTH_REQUIRED, NewSessionResult, RESOURCE_NOT_FOUND } from "../acp/frames";
import type { RpcFailure } from "../acp/rpc";
import type { AgyLauncher, AgyProcess } from "../agy-process";
import type { AgyCatalogs } from "../catalog/catalogs";
import type { AgyInstall } from "../install";
import { firstPromptTitle, titleOf } from "../store/list";
import type { MadeSessions } from "../store/made";
import type { AgySessions } from "../store/sessions";
import type { AgyTranscripts } from "../store/transcript";
import { capacityRefusal, evictionCandidate } from "./cap";
import { AgyFront } from "./front";
import { AgyHost, type HostFacts } from "./host";
import type { RowFacts } from "./host-row";
import { loadSession } from "./load";
import { isLockableId, POLL_MS, PresenceLocks } from "./lock";
import type { PhonePrompts } from "./phone-prompts";
import { LOAD_SETTLE, type SettleBounds } from "./settle";
import { UnviewedHosts } from "./unviewed";
import { AgyView, type Reopened } from "./view";
import { openWatched, WATCHING_NOTICE, type WatchDeps } from "./watch";

export interface HostsDeps {
	readonly install: AgyInstall;
	readonly launch: AgyLauncher;
	readonly client: { readonly name: string; readonly version: string };
	readonly fileLock: FileLock;
	readonly maxSessions: number;
	readonly prompts: PhonePrompts;
	readonly made: MadeSessions;
	readonly sessions: AgySessions;
	readonly transcripts: AgyTranscripts;
	readonly catalogs: AgyCatalogs;
	readonly catalog: CatalogSink;
	readonly clock: Clock;
	readonly log: (message: string) => void;
}

type Loaded = AgyHost | Rejected | "held";
type Hosted = Reopened | Rejected | "held";

export class AgyHosts {
	private readonly hosts = new Map<string, AgyHost>();
	private readonly closing = new Map<string, Promise<void>>();
	private readonly unviewed: UnviewedHosts;
	private readonly locks: PresenceLocks;
	private readonly front: AgyFront;
	private readonly shutdown = new AbortController();
	private readonly now: () => number;
	private opening = 0;

	constructor(private readonly deps: HostsDeps) {
		this.now = () => deps.clock.now();
		this.unviewed = new UnviewedHosts(deps.clock, (host) => void this.closeHost(host));
		this.locks = new PresenceLocks(deps.install.presenceDir, deps.fileLock);
		this.front = new AgyFront(deps.launch, {
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
		return isRejected(made) ? made : this.viewOf({ host: made }, sink);
	}

	async openExisting(sessionId: string, sink: SessionSink): Promise<OpenResult> {
		if (!isLockableId(sessionId)) return rejected("not_found", `no Antigravity session ${sessionId}`);
		if (!this.locks.heldElsewhere(sessionId)) {
			const hosted = await this.hosted(sessionId);
			if (hosted !== "held") return isRejected(hosted) ? hosted : this.viewOf(hosted, sink);
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
	 * part of the run already), and the user messages this bridge sent carry their `clientRequestId` and images.
	 */
	shown(sessionId: string): (items: readonly TranscriptItem[]) => readonly TranscriptItem[] {
		return (items) => {
			const prompt = this.host(sessionId)?.runningPrompt;
			const shown = prompt === undefined ? items : beforeRun(items, prompt);
			return this.deps.prompts.restored(sessionId, shown, prompt !== undefined);
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

	/** A new session, made in place of `replaces` when agy lost that one. */
	private async created(options: NewSessionOptions, replaces?: string): Promise<AgyHost | Rejected> {
		const front = await this.front.connection();
		if (!front.ok) return rejected("backend_error", `Antigravity could not start: ${front.failure.message}`);
		const params = { cwd: options.cwd, mcpServers: [] };
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
		const at = this.now();
		const handedBack = replaces === undefined ? undefined : this.deps.made.get(replaces)?.firstPrompt;
		const host = this.hostOf(front.result, lock, {
			sessionId,
			cwd: options.cwd,
			origin: "broski",
			title: firstPromptTitle(handedBack),
			updatedAt: at,
			options: made.result.configOptions ?? [],
		});
		const chosen = await chosenSettings(host, options);
		if (chosen !== undefined) {
			await host.close();
			return chosen;
		}
		this.deps.made.note(sessionId, options, at, replaces);
		return host;
	}

	/** The session hosted, or made again in its place when agy lost it before storing it; `held` when a terminal has it. */
	private async hosted(sessionId: string): Promise<Hosted> {
		const host = await this.loaded(sessionId);
		if (host instanceof AgyHost) return { host };
		if (host === "held" || host.rejection.code !== "not_found") return host;
		return (await this.replaced(sessionId)) ?? host;
	}

	/**
	 * A session this bridge made that agy never stored (its first turn was cut off, by a restart of the bridge or of agy,
	 * before the model had it): a new one in its folder, with its settings, takes its place and its record, and what the
	 * person wrote in it goes back to them, never to agy.
	 */
	private async replaced(lost: string): Promise<Reopened | Rejected | undefined> {
		const made = this.deps.made.get(lost);
		if (made === undefined || made.stored) return undefined;
		const host = await this.withRoom(() => this.created(made.options, lost));
		if (isRejected(host)) return host;
		return { host, returned: made.firstPrompt === undefined ? [] : [made.firstPrompt] };
	}

	/** The session hosted, loaded in a new host when none runs it; `held` when a terminal has it. */
	private async loaded(sessionId: string): Promise<Loaded> {
		await this.closing.get(sessionId);
		const hosted = this.host(sessionId);
		if (hosted !== undefined) return hosted;
		const found = await this.located(sessionId);
		if (isRejected(found)) return found;
		return this.withRoom<AgyHost | "held">(() => this.load(found));
	}

	/** `session/load` of a session whose lock is ours. */
	private async load(facts: RowFacts): Promise<Loaded> {
		const { sessionId } = facts;
		const taken = this.locks.take(sessionId);
		if (taken.kind !== "taken") return taken.kind === "held" ? "held" : rejected("backend_error", taken.message);
		const front = await this.front.connection();
		if (!front.ok) {
			taken.lock.release();
			return rejected("backend_error", `Antigravity could not start: ${front.failure.message}`);
		}
		// No folder only for a session agy lists without one, which agy reports in the folder it runs in: the void one.
		const params = { sessionId, cwd: facts.cwd ?? this.deps.install.voidDir, mcpServers: [] } as const;
		const { loaded, facts: replayed } = await loadSession(front.result.acp.rpc, params);
		if (!loaded.ok && (loaded.failure.code === RESOURCE_NOT_FOUND || /not found/i.test(loaded.failure.message))) {
			taken.discard();
			return rejected("not_found", `no Antigravity session ${sessionId}`);
		}
		if (!loaded.ok) {
			taken.lock.release();
			return refusalOf("could not load the session", loaded.failure);
		}
		const options = loaded.result.configOptions ?? [];
		const host = this.hostOf(front.result, taken.lock, { ...facts, options }, LOAD_SETTLE);
		for (const update of replayed) host.replayed(update);
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
			this.unviewed.review(opened);
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

	private hostOf(agy: AgyProcess, lock: LockFile, facts: HostFacts, settle?: SettleBounds): AgyHost {
		return new AgyHost(
			{
				agy,
				lock,
				...(settle !== undefined && { settle }),
				prompts: this.deps.prompts,
				catalog: this.deps.catalog,
				catalogChanged: () => this.deps.catalogs.invalidate(),
				commandsAnnounced: (cwd, commands) => void this.deps.catalogs.announced(cwd, commands),
				now: this.now,
				log: this.deps.log,
				ran: (host) => {
					this.deps.sessions.invalidate();
					this.deps.transcripts.invalidate(host.sessionId);
				},
				prompted: (host, text) => this.deps.made.prompted(host.sessionId, text, host.settings()),
				viewChanged: (host) => this.unviewed.review(host),
				ended: (host) => this.forget(host),
			},
			facts,
		);
	}

	private viewOf({ host, returned }: Reopened, sink: SessionSink): OpenResult {
		const view = new AgyView({ reopen: (sessionId) => this.reopened(sessionId), now: this.now }, host, sink);
		if (returned !== undefined) view.replacedOnOpen(returned);
		return { status: "accepted", session: view, snapshot: view.snapshot() };
	}

	private async reopened(sessionId: string): Promise<Reopened | Rejected> {
		const hosted = await this.hosted(sessionId);
		return hosted === "held" ? rejected("busy", WATCHING_NOTICE) : hosted;
	}

	private forget(host: AgyHost): void {
		this.unviewed.forget(host);
		if (this.hosts.get(host.sessionId) === host) this.hosts.delete(host.sessionId);
	}

	/**
	 * The session as its host starts it: agy's row, listed afresh when the kept listing lacks it, or the bridge's own
	 * record of one it made that agy has not stored. Where it runs is the folder agy keeps, else the one the bridge made
	 * it in; one that is neither the bridge's nor listed is none agy has.
	 */
	private async located(sessionId: string): Promise<RowFacts | Rejected> {
		const found = await this.deps.sessions.locate(sessionId);
		if (!found.ok)
			return rejected("backend_error", `Antigravity could not list its sessions: ${found.failure.message}`);
		if (found.result === undefined) return rejected("not_found", `no Antigravity session ${sessionId}`);
		const { cwd, updatedAt } = found.result;
		const origin = this.deps.made.origin(sessionId);
		const title = titleOf(found.result);
		return { sessionId, cwd: cwd ?? this.deps.made.get(sessionId)?.options.cwd, origin, title, updatedAt };
	}

	private watchDeps(sessionId: string): WatchDeps {
		return {
			ref: { backend: "antigravity", sessionId },
			terminalHolds: () => this.locks.heldElsewhere(sessionId),
			locate: () => this.located(sessionId),
			openHosted: async (sink) => {
				const hosted = await this.reopened(sessionId);
				return isRejected(hosted) ? hosted : this.viewOf(hosted, sink);
			},
			pollMs: POLL_MS,
			now: this.now,
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
