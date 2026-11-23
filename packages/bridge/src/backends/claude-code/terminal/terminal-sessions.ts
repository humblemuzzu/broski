/** The sessions a terminal writes that are open here: one `WatchedSession` per session, one `ProjectWatch` per directory. */

import { dirname } from "node:path";
import type { SessionId, SessionSink } from "../../../contract";
import type { Clock } from "../ports/time";
import { ProjectWatch } from "./project-watch";
import { WatchedSession } from "./watch-session";

interface Entry {
	readonly session: WatchedSession;
	holders: number;
}

interface Waiter {
	readonly resolve: (session: WatchedSession | undefined) => void;
}

export class TerminalSessions {
	private readonly entries = new Map<SessionId, Entry>();
	private readonly opening = new Map<SessionId, Promise<Entry>>();
	private readonly bySessionPath = new Map<string, SessionId>();
	private readonly watches = new Map<string, ProjectWatch>();
	private readonly waiters = new Map<SessionId, Set<Waiter>>();
	private readonly asked = new Map<SessionId, number>();
	private disposed = false;

	constructor(private readonly clock: Clock) {}

	/** Opens the session once, whoever asks; each call is one holder to `release`. */
	async acquire(sessionId: SessionId, path: string, sink: SessionSink, activeProcess = false): Promise<WatchedSession> {
		const entry = await this.entryFor(sessionId, path, activeProcess);
		entry.holders += 1;
		const session = entry.session;
		session.attach(sink);
		this.wake(sessionId, session);
		session.schedule();
		return session;
	}

	/** The terminal process holding `sessionId` went idle or exited. */
	terminalIdle(sessionId: SessionId): void {
		this.entries.get(sessionId)?.session.terminalIdle();
	}

	/** The terminal process holding `sessionId` exited: flush any final bytes and settle any open run. */
	async finishExited(sessionId: SessionId): Promise<void> {
		await this.entries.get(sessionId)?.session.finishExited();
	}

	/** The open watched session's active run start time, if one is currently watched. */
	runStartedAt(sessionId: SessionId): number | undefined {
		const snapshot = this.entries.get(sessionId)?.session.live.snapshot();
		return snapshot?.run?.startedAt ?? snapshot?.compaction?.startedAt;
	}

	release(sessionId: SessionId, sink: SessionSink): void {
		const entry = this.entries.get(sessionId);
		if (entry === undefined) return;
		entry.session.detach(sink);
		entry.holders -= 1;
		if (entry.holders <= 0) this.drop(sessionId, entry);
	}

	/** A terminal's hook ask names this session: it is being written, whatever its file's age. */
	markAsked(sessionId: SessionId): () => void {
		this.asked.set(sessionId, (this.asked.get(sessionId) ?? 0) + 1);
		let done = false;
		return () => {
			if (done) return;
			done = true;
			const left = (this.asked.get(sessionId) ?? 1) - 1;
			if (left <= 0) this.asked.delete(sessionId);
			else this.asked.set(sessionId, left);
		};
	}

	isAsked(sessionId: SessionId): boolean {
		return this.asked.has(sessionId);
	}

	/** The open session, now or when it opens; undefined when `signal` aborts first. */
	watched(sessionId: SessionId, signal: AbortSignal): Promise<WatchedSession | undefined> {
		const open = this.entries.get(sessionId);
		if (open !== undefined) return Promise.resolve(open.session);
		if (signal.aborted) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			const waiter: Waiter = {
				resolve: (session) => {
					signal.removeEventListener("abort", onAbort);
					resolve(session);
				},
			};
			const onAbort = () => {
				const waiting = this.waiters.get(sessionId);
				waiting?.delete(waiter);
				if (waiting?.size === 0) this.waiters.delete(sessionId);
				resolve(undefined);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			const set = this.waiters.get(sessionId) ?? new Set();
			set.add(waiter);
			this.waiters.set(sessionId, set);
		});
	}

	dispose(): void {
		this.disposed = true;
		for (const [sessionId, entry] of [...this.entries]) this.drop(sessionId, entry);
		for (const watch of this.watches.values()) watch.stop();
		this.watches.clear();
		for (const set of this.waiters.values()) for (const waiter of set) waiter.resolve(undefined);
		this.waiters.clear();
	}

	private entryFor(sessionId: SessionId, path: string, activeProcess: boolean): Promise<Entry> {
		const existing = this.entries.get(sessionId);
		if (existing !== undefined) return Promise.resolve(existing);
		const pending = this.opening.get(sessionId);
		if (pending !== undefined) return pending;
		const created = this.create(sessionId, path, activeProcess).finally(() => this.opening.delete(sessionId));
		this.opening.set(sessionId, created);
		return created;
	}

	private async create(sessionId: SessionId, path: string, activeProcess: boolean): Promise<Entry> {
		const session = await WatchedSession.open(path, this.clock, activeProcess);
		if (this.disposed) {
			session.dispose();
			throw new Error("the terminal watch is disposed");
		}
		const entry: Entry = { session, holders: 0 };
		this.entries.set(sessionId, entry);
		this.bySessionPath.set(path, sessionId);
		this.watchFor(dirname(path)).track(path);
		return entry;
	}

	private drop(sessionId: SessionId, entry: Entry): void {
		this.entries.delete(sessionId);
		entry.session.dispose();
		this.bySessionPath.delete(entry.session.path);
		const dir = dirname(entry.session.path);
		const watch = this.watches.get(dir);
		watch?.untrack(entry.session.path);
		if (watch !== undefined && watch.size === 0) this.watches.delete(dir);
	}

	private watchFor(dir: string): ProjectWatch {
		const existing = this.watches.get(dir);
		if (existing !== undefined) return existing;
		const watch = new ProjectWatch(dir, (path) => this.changed(path), this.clock);
		this.watches.set(dir, watch);
		return watch;
	}

	private changed(path: string): void {
		const sessionId = this.bySessionPath.get(path);
		if (sessionId !== undefined) this.entries.get(sessionId)?.session.schedule();
	}

	private wake(sessionId: SessionId, session: WatchedSession): void {
		const set = this.waiters.get(sessionId);
		if (set === undefined) return;
		this.waiters.delete(sessionId);
		for (const waiter of set) waiter.resolve(session);
	}
}
