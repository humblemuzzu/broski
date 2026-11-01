/** The `TerminalWatch` `backend.ts` builds (D21): a session another process writes opens watch-only, never resumed. */

import { stat } from "node:fs/promises";
import type { OpenResult, SessionId, SessionRef, SessionSink } from "../../../contract";
import type { TerminalDeps } from "../ports/deps";
import type { StoredSession } from "../ports/store";
import type { TerminalWatch } from "../ports/terminal";
import { isRejected } from "../rejections";
import { createHookAsks } from "./hook-asks";
import { TerminalSessions } from "./terminal-sessions";

/** A file written this recently, by a process this bridge does not host, belongs to a terminal (research 04 §7 rec. 6). */
export const WRITING_MS = 10_000;

export function createTerminalWatch(deps: TerminalDeps): TerminalWatch {
	const { services } = deps;
	const enabled = services.terminal.watch !== false;
	const sessions = new TerminalSessions(services.clock);
	const paths = new Map<SessionId, string>();

	async function pathOf(sessionId: SessionId): Promise<string | undefined> {
		const known = paths.get(sessionId);
		if (known !== undefined) return known;
		const stored = await deps.locate(sessionId);
		if (isRejected(stored)) return undefined;
		paths.set(sessionId, stored.path);
		return stored.path;
	}

	async function writing(sessionId: SessionId): Promise<boolean> {
		if (!enabled || deps.hosted(sessionId)) return false;
		if (sessions.isAsked(sessionId)) return true;
		const path = await pathOf(sessionId);
		if (path === undefined) return false;
		try {
			const age = services.clock.now() - (await stat(path)).mtimeMs;
			return age <= WRITING_MS;
		} catch {
			paths.delete(sessionId);
			return false;
		}
	}

	async function openWatchOnly(ref: SessionRef, stored: StoredSession, sink: SessionSink): Promise<OpenResult> {
		paths.set(stored.sessionId, stored.path);
		const session = await sessions.acquire(ref.sessionId, stored.path, sink);
		let closed = false;
		return {
			status: "accepted",
			snapshot: session.live.snapshot(),
			session: {
				session: ref,
				snapshot: () => session.live.snapshot(),
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
			if (enabled) services.terminal.hookAsks?.(createHookAsks({ sessions, hosted: deps.hosted }));
		},
		dispose: async () => {
			sessions.dispose();
			paths.clear();
		},
	};
}
