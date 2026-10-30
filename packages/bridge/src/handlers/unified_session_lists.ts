/**
 * `unified_list_sessions`: one listing for whichever backend the app names.
 *
 * Every case answers with the same page contract as that backend's own list message, so the app
 * pages all five backends with one piece of code.
 */

import type { UnifiedMessage } from "../routing/messages";
import type { ClaudeCodeSession, CodexThread, SessionSummary } from "../types";
import type { BroskiBackend } from "../types/runtime";
import {
	isPagedSessionRequest,
	pageSessionList,
	type SessionListRow,
	sessionPageFields,
	sessionPageRequest,
} from "../utils/session-list-page";
import { type CxThreadListContext, localThreads } from "./codex/cx_thread_list";

export type UnifiedSessionListContext = {
	claudeCode: { listSessions: (cwd?: string) => Promise<ClaudeCodeSession[]> };
	requireOpenCode: () => {
		listSessions: (dir?: string, opts?: { roots?: boolean; limit?: number }) => Promise<SessionSummary[]>;
	} | null;
	codex: CxThreadListContext;
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

/** A page is cut from the whole listing, so the source is asked for all of it and for no cursor of its own. */
const sourceLimit = (message: UnifiedListMessage): number | undefined =>
	isPagedSessionRequest(sessionPageRequest(message)) ? undefined : message.limit;

const ccRow = (session: ClaudeCodeSession): SessionListRow => ({ id: session.id, modified: session.updatedAt });
const cxRow = (thread: CodexThread): SessionListRow => ({ id: thread.id, modified: thread.updatedAt });
const ocRow = (session: SessionSummary): SessionListRow => ({ id: session.id, modified: session.time?.updated ?? 0 });

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
		case "codex": {
			const threads = await localThreads({ cwd: message.cwd }, ctx.codex);
			replyPage(message, reply, backend, threads, cxRow);
			return;
		}
		case "opencode": {
			const openCode = ctx.requireOpenCode();
			const roots = message.roots ?? true;
			const sessions = openCode ? await openCode.listSessions(message.cwd, { roots, limit: sourceLimit(message) }) : [];
			replyPage(message, reply, backend, sessions, ocRow);
			return;
		}
		default: {
			reply({ type: "unified_sessions", backend, data: [], requestId: message.requestId });
		}
	}
}
