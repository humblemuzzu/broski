/** The `TerminalWatch` `backend.ts` builds (D28): a session another process writes opens watch-only, never resumed. */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { InteractionAnswer, OpenSession, SessionId, SessionRef } from "../../../contract";
import type { TerminalDeps } from "../ports/deps";
import type { TerminalPresenceEvent, TerminalWatch } from "../ports/terminal";
import { CLOSED, isRejected, rejected } from "../rejections";
import { CliProcesses } from "./cli-processes";
import { createHookAsks } from "./hook-asks";
import { TerminalSessions } from "./terminal-sessions";
import type { WatchedSession } from "./watch-session";

/** A file written this recently, by a process this bridge does not host, belongs to a terminal (D28). */
const WRITING_MS = 10_000;
/**
 * The CLI flushes its transcript about 100 ms late (D25), so a write this soon after the bridge's own was still its.
 */
export const OWN_FLUSH_MS = 1_000;
const MAX_KNOWN_PATHS = 5_000;

export function createTerminalWatch(deps: TerminalDeps): TerminalWatch {
	const { services } = deps;
	/** Only a bridge that installed the ask hook (the server gave `hookAsks`) has asks here to answer. */
	const takesAsks = services.terminal.hookAsks !== undefined;
	const sessions = new TerminalSessions(services.clock);
	const paths = new TranscriptPaths(deps.locate);
	/** When a tracked terminal last finished a turn or exited each session, so its final flush does not re-trigger `WRITING_MS`. */
	const settledAt = new Map<SessionId, number>();
	const active = new Set<SessionId>();
	const quietChecks = new Map<SessionId, () => void>();
	const presenceWatchers = new Map<SessionId, Set<(event: TerminalPresenceEvent) => void>>();
	let disposed = false;
	const cancelQuietCheck = (sessionId: SessionId): void => {
		quietChecks.get(sessionId)?.();
		quietChecks.delete(sessionId);
	};
	const notifyPresence = (sessionId: SessionId, event: TerminalPresenceEvent): void => {
		const listeners = presenceWatchers.get(sessionId);
		if (listeners === undefined) return;
		for (const listener of [...listeners]) listener(event);
	};
	const armQuietCheck = (sessionId: SessionId): void => {
		if (
			disposed ||
			quietChecks.has(sessionId) ||
			active.has(sessionId) ||
			sessions.isAsked(sessionId) ||
			presenceWatchers.get(sessionId)?.size === undefined
		) {
			return;
		}
		const cancel = services.clock.after(WRITING_MS + 100, () => {
			quietChecks.delete(sessionId);
			if (disposed || presenceWatchers.get(sessionId)?.size === undefined || active.has(sessionId)) return;
			void writing(deps, sessions, paths, processes, settledAt, sessionId).then((stillWriting) => {
				if (disposed) return;
				if (stillWriting) armQuietCheck(sessionId);
				else notifyPresence(sessionId, "idle");
			});
		});
		quietChecks.set(sessionId, cancel);
	};
	const noteSettled = (sessionId: SessionId): void => {
		if (settledAt.size >= MAX_KNOWN_PATHS) {
			const oldest = settledAt.keys().next();
			if (!oldest.done) settledAt.delete(oldest.value);
		}
		settledAt.set(sessionId, services.clock.now());
	};
	const processes = new CliProcesses(
		join(services.sdk.configRoot(), "sessions"),
		services.clock,
		(sessionId, transition) => {
			const status = processes.row(sessionId)?.status;
			const nowActive = transition !== "exited" && (status === "running" || status === "waiting_for_user");
			const wasActive = active.has(sessionId);
			if (!wasActive && nowActive) {
				active.add(sessionId);
				cancelQuietCheck(sessionId);
				settledAt.delete(sessionId);
				notifyPresence(sessionId, "active");
			} else if (wasActive && !nowActive) {
				active.delete(sessionId);
				noteSettled(sessionId);
				sessions.terminalIdle(sessionId);
				notifyPresence(sessionId, "idle");
			} else if (transition === "exited") {
				noteSettled(sessionId);
				sessions.terminalIdle(sessionId);
				notifyPresence(sessionId, "idle");
			}
			deps.announce(sessionId);
		},
	);
	return {
		writing: (sessionId) => writing(deps, sessions, paths, processes, settledAt, sessionId),
		hasIdleTerminal: async (sessionId) => {
			if (deps.hosted(sessionId) || sessions.isAsked(sessionId)) return false;
			return (await processes.holder(sessionId))?.status === "idle";
		},
		row: (sessionId) => {
			if (deps.hosted(sessionId)) return undefined;
			const row = processes.row(sessionId);
			if (row === undefined) return undefined;
			const runStartedAt = sessions.runStartedAt(sessionId);
			return runStartedAt !== undefined ? { ...row, runStartedAt } : row;
		},
		openWatchOnly: async (ref, stored, sink) => {
			paths.remember(stored.sessionId, stored.path);
			const status = processes.row(ref.sessionId)?.status;
			const activeProcess = status === "running" || status === "waiting_for_user";
			const session = await sessions.acquire(ref.sessionId, stored.path, sink, activeProcess).catch(() => undefined);
			if (session === undefined) return rejected("backend_error", "the terminal session could not be followed");
			const open = watchOnlySession(ref, session, takesAsks, () => {
				sessions.release(ref.sessionId, sink);
				if (presenceWatchers.get(ref.sessionId)?.size === undefined) cancelQuietCheck(ref.sessionId);
			});
			armQuietCheck(ref.sessionId);
			return { status: "accepted", snapshot: session.live.snapshot(), session: open };
		},
		watchPresence: (sessionId, listener) => {
			const set = presenceWatchers.get(sessionId) ?? new Set();
			set.add(listener);
			presenceWatchers.set(sessionId, set);
			return () => {
				set.delete(listener);
				if (set.size === 0 && presenceWatchers.get(sessionId) === set) {
					presenceWatchers.delete(sessionId);
					cancelQuietCheck(sessionId);
				}
			};
		},
		finishExited: (sessionId) => sessions.finishExited(sessionId),
		start: async () => {
			services.terminal.hookAsks?.(createHookAsks({ sessions, hosted: deps.hosted }));
			processes.start();
		},
		dispose: async () => {
			disposed = true;
			processes.dispose();
			sessions.dispose();
			paths.clear();
			settledAt.clear();
			active.clear();
			for (const cancel of quietChecks.values()) cancel();
			quietChecks.clear();
			presenceWatchers.clear();
		},
	};
}

/** Where each session's transcript lies, looked up once and remembered, a bounded number of them. */
class TranscriptPaths {
	private readonly paths = new Map<SessionId, string>();

	constructor(private readonly locate: TerminalDeps["locate"]) {}

	async of(sessionId: SessionId): Promise<string | undefined> {
		const known = this.paths.get(sessionId);
		if (known !== undefined) return known;
		const stored = await this.locate(sessionId).catch(() => undefined);
		if (stored === undefined || isRejected(stored)) return undefined;
		this.remember(sessionId, stored.path);
		return stored.path;
	}

	remember(sessionId: SessionId, path: string): void {
		if (this.paths.size >= MAX_KNOWN_PATHS) this.paths.clear();
		this.paths.set(sessionId, path);
	}

	forget(sessionId: SessionId): void {
		this.paths.delete(sessionId);
	}

	clear(): void {
		this.paths.clear();
	}
}

/**
 * Whether a terminal is actively running or writing the session now: it has an ask raised, a tracked terminal
 * `claude` reports `busy` or `waiting`, or (when no tracked process reports `idle`) its file was written lately
 * and not by us.
 */
async function writing(
	deps: TerminalDeps,
	sessions: TerminalSessions,
	paths: TranscriptPaths,
	processes: CliProcesses,
	settledAt: ReadonlyMap<SessionId, number>,
	sessionId: SessionId,
): Promise<boolean> {
	if (deps.hosted(sessionId)) return false;
	if (sessions.isAsked(sessionId)) return true;
	const holder = await processes.holder(sessionId);
	if (holder !== undefined) {
		if (holder.status === "running" || holder.status === "waiting_for_user") return true;
		if (holder.status === "idle") return false;
	}
	const path = await paths.of(sessionId);
	if (path === undefined) return false;
	try {
		const written = (await stat(path)).mtimeMs;
		const own = deps.ownWriteAt(sessionId);
		if (own !== undefined && written <= own + OWN_FLUSH_MS) return false;
		const settled = settledAt.get(sessionId);
		if (settled !== undefined && written <= settled + OWN_FLUSH_MS) return false;
		return deps.services.clock.now() - written <= WRITING_MS;
	} catch {
		paths.forget(sessionId);
		return false;
	}
}

/** The `OpenSession` of a followed terminal session: no control, and `answer` only where the hook raises asks. */
function watchOnlySession(
	ref: SessionRef,
	session: WatchedSession,
	takesAsks: boolean,
	release: () => void,
): OpenSession {
	let closed = false;
	return {
		session: ref,
		snapshot: () => session.live.snapshot(),
		...(takesAsks && {
			answer: async (answer: InteractionAnswer) => (closed ? CLOSED : session.desk.answer(answer)),
		}),
		close: async () => {
			if (closed) return;
			closed = true;
			release();
		},
	};
}
