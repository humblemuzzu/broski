/**
 * The adapter's side of a terminal's permission ask (D29). The server's receiver calls this handler first and holds the
 * session open (`BridgeCore.hold`) right after, so the handler marks the session as written before anyone opens it: the
 * open then takes the watch-only path, never a resume of a session a terminal is running.
 */

import type { SessionId } from "../../../contract";
import type { TerminalAskHandler } from "../ports/terminal";
import { isPersonOnlyTool } from "./hook-interaction";
import type { TerminalSessions } from "./terminal-sessions";

export interface HookAskDeps {
	readonly sessions: TerminalSessions;
	readonly hosted: (sessionId: SessionId) => boolean;
}

export function createHookAsks(deps: HookAskDeps): TerminalAskHandler {
	return async (ask, signal) => {
		const sessionId = ask.session_id;
		if (isPersonOnlyTool(ask.tool_name) || deps.hosted(sessionId)) return undefined;
		const unmark = deps.sessions.markAsked(sessionId);
		try {
			const session = await deps.sessions.watched(sessionId, signal);
			if (session === undefined) return undefined;
			return (await session.desk.raise(ask, signal)).decision;
		} finally {
			unmark();
		}
	};
}
