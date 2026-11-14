/** The `TerminalWatch` `backend.ts` builds (D28): a session another process writes opens watch-only, never resumed. */

import { stat } from "node:fs/promises";
import type { InteractionAnswer, OpenResult, SessionId, SessionRef, SessionSink } from "../../../contract";
import type { TerminalDeps } from "../ports/deps";
import type { StoredSession } from "../ports/store";
import type { TerminalWatch } from "../ports/terminal";
import { CLOSED, isRejected, rejected } from "../rejections";
import { createHookAsks } from "./hook-asks";
import { TerminalSessions } from "./terminal-sessions";

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
	const paths = new Map<SessionId, string>();

	async function pathOf(sessionId: SessionId): Promise<string | undefined> {
		const known = paths.get(sessionId);
		if (known !== undefined) return known;
		const stored = await deps.locate(sessionId).catch(() => undefined);
		if (stored === undefined || isRejected(stored)) return undefined;
		remember(sessionId, stored.path);
		return stored.path;
	}

	function remember(sessionId: SessionId, path: string): void {
		if (paths.size >= MAX_KNOWN_PATHS) paths.clear();
		paths.set(sessionId, path);
	}

	async function writing(sessionId: SessionId): Promise<boolean> {
		if (deps.hosted(sessionId)) return false;
		if (sessions.isAsked(sessionId)) return true;
		const path = await pathOf(sessionId);
		if (path === undefined) return false;
		try {
			const written = (await stat(path)).mtimeMs;
			const own = deps.ownWriteAt(sessionId);
			if (own !== undefined && written <= own + OWN_FLUSH_MS) return false;
			return services.clock.now() - written <= WRITING_MS;
		} catch {
			paths.delete(sessionId);
			return false;
		}
	}

	async function openWatchOnly(ref: SessionRef, stored: StoredSession, sink: SessionSink): Promise<OpenResult> {
		remember(stored.sessionId, stored.path);
		const session = await sessions.acquire(ref.sessionId, stored.path, sink).catch(() => undefined);
		if (session === undefined) return rejected("backend_error", "the terminal session could not be followed");
		let closed = false;
		return {
			status: "accepted",
			snapshot: session.live.snapshot(),
			session: {
				session: ref,
				snapshot: () => session.live.snapshot(),
				...(takesAsks && {
					answer: async (answer: InteractionAnswer) => (closed ? CLOSED : session.desk.answer(answer)),
				}),
				close: async () => {
					if (closed) return;
					closed = true;
					sessions.release(ref.sessionId, sink);
				},
			},
		};
	}

	return {
		writing,
		openWatchOnly,
		start: async () => {
			services.terminal.hookAsks?.(createHookAsks({ sessions, hosted: deps.hosted }));
		},
		dispose: async () => {
			sessions.dispose();
			paths.clear();
		},
	};
}
