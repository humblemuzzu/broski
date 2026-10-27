import { pageSessionMessages } from "../connectors/opencode/oc-transcript-page";
import type { ClientMessage, PermissionRuleset, ServerMessage, SessionContextInfo, SessionSummary } from "../types";
import {
	DEFAULT_TRANSCRIPT_PAGE_LIMIT,
	transcriptCursor,
	transcriptPageFields,
	transcriptPageLimit,
} from "../types/transcript-page";

type Reply = (message: ServerMessage) => void;

/** One client message of the given type, with the request id the reply must echo. */
type Msg<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }> & { requestId?: string };

type OpenCodeSessionOpsLike = {
	createSession: (
		dir?: string,
		title?: string,
		permission?: PermissionRuleset,
		workspaceID?: string,
	) => Promise<SessionSummary>;
	getSession: (id: string, dir?: string) => Promise<SessionSummary>;
	getSessionMessages: (id: string, dir?: string) => Promise<unknown>;
	deleteSession: (id: string, dir?: string) => Promise<boolean>;
	updateSession: (id: string, title?: string, archived?: boolean, dir?: string) => Promise<SessionSummary>;
	forkSession: (id: string, msgId?: string, dir?: string) => Promise<SessionSummary>;
	listSessionChildren: (id: string, dir?: string) => Promise<SessionSummary[]>;
	revertMessage: (id: string, msgId: string, partId?: string, dir?: string) => Promise<SessionSummary>;
	unrevertSession: (id: string, dir?: string) => Promise<SessionSummary>;
	shareSession: (id: string, dir?: string) => Promise<SessionSummary>;
	unshareSession: (id: string, dir?: string) => Promise<SessionSummary>;
	summarizeSession: (id: string, provID: string, modelID: string, dir?: string, auto?: boolean) => Promise<boolean>;
	initSession: (id: string, provID: string, modelID: string, msgID: string, dir?: string) => Promise<boolean>;
	getSessionDiff: (id: string, dir?: string, msgId?: string) => Promise<unknown>;
	getSessionContext: (id: string, dir?: string) => Promise<SessionContextInfo>;
};

type OpenCode = OpenCodeSessionOpsLike;

async function createSession(oc: OpenCode, message: Msg<"create_session">, reply: Reply): Promise<void> {
	const session = await oc.createSession(message.projectPath, message.title, message.permission, message.workspaceID);
	reply({ type: "session_created", data: session });
}

/**
 * The transcript, or one page of it. Paging windows the list the bridge already fetches: asking
 * the OpenCode server for `limit`/`before` would hand out a boundary the app cannot resume from.
 */
async function sessionMessages(oc: OpenCode, message: Msg<"get_session_messages">, reply: Reply): Promise<void> {
	const limit = transcriptPageLimit(message.limit);
	const before = transcriptCursor(message.before);
	const messages = (await oc.getSessionMessages(message.sessionId, message.projectPath)) ?? [];
	if (limit === undefined && before === undefined) {
		reply({ type: "session_messages", data: messages, sessionId: message.sessionId });
		return;
	}
	const page = pageSessionMessages(messages as never, {
		limit: limit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT,
		before,
	});
	reply({
		type: "session_messages",
		data: page.messages,
		sessionId: message.sessionId,
		...transcriptPageFields(page),
	});
}

async function deleteSession(oc: OpenCode, message: Msg<"delete_session">, reply: Reply): Promise<void> {
	const deleted = await oc.deleteSession(message.sessionId, message.projectPath);
	reply({ type: "session_deleted", data: deleted, sessionId: message.sessionId });
}

async function updateSession(oc: OpenCode, message: Msg<"update_session">, reply: Reply): Promise<void> {
	const session = await oc.updateSession(message.sessionId, message.title, message.archived, message.projectPath);
	reply({ type: "session_updated", data: session, sessionId: message.sessionId });
}

async function forkSession(oc: OpenCode, message: Msg<"fork_session">, reply: Reply): Promise<void> {
	const session = await oc.forkSession(message.sessionId, message.messageId, message.projectPath);
	reply({ type: "session_forked", data: session });
}

async function sessionChildren(oc: OpenCode, message: Msg<"session_children">, reply: Reply): Promise<void> {
	const sessions = await oc.listSessionChildren(message.sessionId, message.projectPath);
	reply({ type: "session_children", data: sessions, sessionId: message.sessionId });
}

async function revertMessage(oc: OpenCode, message: Msg<"revert_message">, reply: Reply): Promise<void> {
	const session = await oc.revertMessage(message.sessionId, message.messageId, message.partId, message.projectPath);
	reply({ type: "message_reverted", data: session, sessionId: message.sessionId });
}

async function unrevertSession(oc: OpenCode, message: Msg<"unrevert_session">, reply: Reply): Promise<void> {
	const session = await oc.unrevertSession(message.sessionId, message.projectPath);
	reply({ type: "session_unreverted", data: session, sessionId: message.sessionId });
}

async function shareSession(oc: OpenCode, message: Msg<"share_session">, reply: Reply): Promise<void> {
	const session = await oc.shareSession(message.sessionId, message.projectPath);
	reply({ type: "session_shared", data: session, sessionId: message.sessionId });
}

async function unshareSession(oc: OpenCode, message: Msg<"unshare_session">, reply: Reply): Promise<void> {
	const session = await oc.unshareSession(message.sessionId, message.projectPath);
	reply({ type: "session_unshared", data: session, sessionId: message.sessionId });
}

async function summarizeSession(oc: OpenCode, message: Msg<"summarize_session">, reply: Reply): Promise<void> {
	const success = await oc.summarizeSession(
		message.sessionId,
		message.providerID,
		message.modelID,
		message.projectPath,
		message.auto,
	);
	reply({ type: "session_summarized", data: success, sessionId: message.sessionId });
}

async function initSession(oc: OpenCode, message: Msg<"init_session">, reply: Reply): Promise<void> {
	const initialized = await oc.initSession(
		message.sessionId,
		message.providerID,
		message.modelID,
		message.messageID,
		message.projectPath,
	);
	reply({ type: "session_initialized", data: initialized, sessionId: message.sessionId });
}

async function sessionDiff(oc: OpenCode, message: Msg<"diff">, reply: Reply): Promise<void> {
	const diff = await oc.getSessionDiff(message.sessionId, message.projectPath, message.messageId);
	reply({ type: "diff", data: diff, sessionId: message.sessionId });
}

async function sessionContext(oc: OpenCode, message: Msg<"get_session_context">, reply: Reply): Promise<void> {
	const context = await oc.getSessionContext(message.sessionId, message.projectPath);
	reply({ type: "session_context", data: context, sessionId: message.sessionId });
}

async function session(oc: OpenCode, message: Msg<"get_session">, reply: Reply): Promise<void> {
	const found = await oc.getSession(message.sessionId, message.projectPath);
	reply({ type: "session", data: found });
}

/** One entry per message type: the narrowing cast lives here, once. */
function op<T extends ClientMessage["type"]>(
	run: (oc: OpenCode, message: Msg<T>, reply: Reply) => Promise<void>,
): (oc: OpenCode, message: ClientMessage & { requestId?: string }, reply: Reply) => Promise<void> {
	return (oc, message, reply) => run(oc, message as Msg<T>, reply);
}

const OPS: Record<
	string,
	(oc: OpenCode, message: ClientMessage & { requestId?: string }, reply: Reply) => Promise<void>
> = {
	create_session: op(createSession),
	get_session: op(session),
	get_session_messages: op(sessionMessages),
	delete_session: op(deleteSession),
	update_session: op(updateSession),
	fork_session: op(forkSession),
	session_children: op(sessionChildren),
	revert_message: op(revertMessage),
	unrevert_session: op(unrevertSession),
	share_session: op(shareSession),
	unshare_session: op(unshareSession),
	summarize_session: op(summarizeSession),
	init_session: op(initSession),
	diff: op(sessionDiff),
	get_session_context: op(sessionContext),
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: Reply,
	requireOpenCode: () => OpenCodeSessionOpsLike,
): Promise<boolean> {
	const run = OPS[message.type];
	if (!run) return false;
	await run(requireOpenCode(), message, reply);
	return true;
}
