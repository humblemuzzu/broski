/**
 * `unified_list_sessions`: one listing for whichever backend the app names.
 *
 * Every case answers with the same page contract as that backend's own list message, so the app
 * pages every backend with one piece of code.
 */

import type { UnifiedMessage } from "../routing/messages";
import type { ClaudeCodeSession } from "../types";
import type { BroskiBackend } from "../types/runtime";
import {
	isPagedSessionRequest,
	pageSessionList,
	type SessionListRow,
	sessionPageFields,
	sessionPageRequest,
} from "../utils/session-list-page";

export type UnifiedSessionListContext = {
	claudeCode: { listSessions: (cwd?: string) => Promise<ClaudeCodeSession[]> };
};

type UnifiedListMessage = UnifiedMessage & { type: "unified_list_sessions" };

type Reply = (message: unknown) => void;

function replyPage<T>(
	message: UnifiedListMessage,
	reply: Reply,
	backend: BroskiBackend,
	items: readonly T[],
	rowOf: (item: T) => SessionListRow,
): void {
	const request = sessionPageRequest(message);
	if (!isPagedSessionRequest(request)) {
		reply({ type: "unified_sessions", backend, data: [...items], requestId: message.requestId });
		return;
	}
	const page = pageSessionList(items, request, rowOf);
	reply({
		type: "unified_sessions",
		backend,
		data: page.items,
		...sessionPageFields(page),
		requestId: message.requestId,
	});
}

const ccRow = (session: ClaudeCodeSession): SessionListRow => ({ id: session.id, modified: session.updatedAt });

export async function unifiedListSessions(
	message: UnifiedListMessage,
	reply: Reply,
	ctx: UnifiedSessionListContext,
): Promise<void> {
	const backend: BroskiBackend = message.backend;
	switch (backend) {
		case "claude-code": {
			const sessions = await ctx.claudeCode.listSessions(message.cwd);
			replyPage(message, reply, backend, sessions, ccRow);
			return;
		}
		default: {
			reply({ type: "unified_sessions", backend, data: [], requestId: message.requestId });
		}
	}
}
