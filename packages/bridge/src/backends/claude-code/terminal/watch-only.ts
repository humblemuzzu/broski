/** The `TerminalWatch` `backend.ts` builds (D28): a session another process writes opens watch-only, never resumed. */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { InteractionAnswer, OpenSession, SessionId, SessionRef } from "../../../contract";
import type { TerminalDeps } from "../ports/deps";
import type { TerminalWatch } from "../ports/terminal";
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
	const processes = new CliProcesses(join(services.sdk.configRoot(), "sessions"), services.clock, (sessionId) => {
		const status = processes.row(sessionId)?.status;
		if (status === undefined || status === "idle") sessions.terminalIdle(sessionId);
		deps.announce(sessionId);
	});
	return {
		writing: (sessionId) => writing(deps, sessions, paths, processes, sessionId),
		row: (sessionId) => (deps.hosted(sessionId) ? undefined : processes.row(sessionId)),
		openWatchOnly: async (ref, stored, sink) => {
			paths.remember(stored.sessionId, stored.path);
			const status = processes.row(ref.sessionId)?.status;
			const activeProcess = status === "running" || status === "waiting_for_user";
			const session = await sessions.acquire(ref.sessionId, stored.path, sink, activeProcess).catch(() => undefined);
			if (session === undefined) return rejected("backend_error", "the terminal session could not be followed");
			const open = watchOnlySession(ref, session, takesAsks, () => sessions.release(ref.sessionId, sink));
			return { status: "accepted", snapshot: session.live.snapshot(), session: open };
		},
		start: async () => {
			services.terminal.hookAsks?.(createHookAsks({ sessions, hosted: deps.hosted }));
			processes.start();
		},
		dispose: async () => {
			processes.dispose();
			sessions.dispose();
			paths.clear();
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
 * Whether a terminal has the session now: it has an ask raised, a terminal `claude` holds it, however quiet, or its
 * file was written lately and not by us.
 */
async function writing(
	deps: TerminalDeps,
	sessions: TerminalSessions,
	paths: TranscriptPaths,
	processes: CliProcesses,
	sessionId: SessionId,
): Promise<boolean> {
	if (deps.hosted(sessionId)) return false;
	if (sessions.isAsked(sessionId)) return true;
	if ((await processes.holder(sessionId)) !== undefined) return true;
	const path = await paths.of(sessionId);
	if (path === undefined) return false;
	try {
		const written = (await stat(path)).mtimeMs;
		const own = deps.ownWriteAt(sessionId);
		if (own !== undefined && written <= own + OWN_FLUSH_MS) return false;
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
