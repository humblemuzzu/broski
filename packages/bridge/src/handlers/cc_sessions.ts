import { readCcTranscriptPage } from "../connectors/claude-code/cc-transcript";
import type { ClaudeCodeSession, ClaudeCodeTranscriptMessage, ProjectSummary, ServerMessage } from "../types";
import {
	DEFAULT_TRANSCRIPT_PAGE_LIMIT,
	transcriptCursor,
	transcriptPageFields,
	transcriptPageLimit,
} from "../types/transcript-page";
import { sessionListReply } from "./session_list_reply";
import type { ModifiedFileEntry } from "./session-stats";

type ReplyFn = (msg: ServerMessage) => void;

type HandlerContext = {
	claudeCode: {
		listProjects: () => Promise<ProjectSummary[]>;
		listSessions: (cwd?: string) => Promise<ClaudeCodeSession[]>;
		getSession: (sessionId: string, cwd?: string) => Promise<ClaudeCodeSession | null>;
		getSessionMessages: (sessionId: string, cwd?: string, limit?: number) => Promise<ClaudeCodeTranscriptMessage[]>;
		deleteSession: (sessionId: string, cwd?: string) => Promise<boolean>;
		forkSession: (sessionId: string, messageId: string, cwd?: string) => Promise<ClaudeCodeSession | null>;
		renameSession: (sessionId: string, name: string, cwd?: string) => Promise<ClaudeCodeSession | null>;
		listActiveSessions: () => { sessionId: string; cwd: string; startedAt: number | undefined }[];
		resolveSessionFilePath: (sessionId: string, cwd?: string) => Promise<string | null>;
		getModifiedFiles: (sessionId: string, cwd?: string) => Promise<ModifiedFileEntry[]>;
	};
};

export async function handle(message: Record<string, unknown>, reply: ReplyFn, ctx: HandlerContext): Promise<boolean> {
	const type = message.type as string;
	switch (type) {
		case "cc_list_projects": {
			const projects = await ctx.claudeCode.listProjects();
			reply({ type: "cc_projects", data: projects });
			return true;
		}
		case "cc_list_sessions": {
			const sessions = await ctx.claudeCode.listSessions(message.cwd as string | undefined);
			reply({
				type: "cc_sessions",
				...sessionListReply(sessions, message, (session: ClaudeCodeSession) => ({
					id: session.id,
					modified: session.updatedAt,
				})),
			});
			return true;
		}
		case "cc_get_session": {
			const session = await ctx.claudeCode.getSession(message.sessionId as string, message.cwd as string | undefined);
			if (session) {
				reply({ type: "cc_session", data: session });
			} else {
				reply({ type: "error", message: "Session not found" });
			}
			return true;
		}
		case "cc_get_session_messages": {
			const sessionId = message.sessionId as string;
			const cwd = message.cwd as string | undefined;
			const limit = typeof message.limit === "number" ? message.limit : undefined;
			const pageLimit = transcriptPageLimit(message.limit);
			const before = transcriptCursor(message.before);

			if (pageLimit !== undefined || before !== undefined) {
				const end = before === undefined ? undefined : Number.parseInt(before, 10);
				const filePath =
					end !== undefined && !Number.isFinite(end)
						? null
						: await ctx.claudeCode.resolveSessionFilePath(sessionId, cwd);
				const page = filePath
					? await readCcTranscriptPage(filePath, { limit: pageLimit ?? DEFAULT_TRANSCRIPT_PAGE_LIMIT, end })
					: null;
				if (page) {
					reply({ type: "cc_session_messages", data: page.messages, sessionId, ...transcriptPageFields(page) });
					return true;
				}
			}

			const items = await ctx.claudeCode.getSessionMessages(sessionId, cwd, limit);
			reply({
				type: "cc_session_messages",
				data: items,
				sessionId,
			});
			return true;
		}
		case "cc_delete_session": {
			const sessionId = message.sessionId as string;
			const deleted = await ctx.claudeCode.deleteSession(sessionId, message.cwd as string | undefined);
			reply({
				type: "cc_session_deleted",
				data: deleted,
				sessionId,
			});
			return true;
		}
		case "cc_fork_session": {
			const forked = await ctx.claudeCode.forkSession(
				message.sessionId as string,
				message.messageId as string,
				message.cwd as string | undefined,
			);
			reply({ type: "cc_session_forked", data: forked });
			return true;
		}
		case "cc_rename_session": {
			const renamed = await ctx.claudeCode.renameSession(
				message.sessionId as string,
				message.name as string,
				message.cwd as string | undefined,
			);
			reply({ type: "cc_session_renamed", data: renamed });
			return true;
		}
		case "cc_get_active_sessions": {
			const sessions = ctx.claudeCode.listActiveSessions().map((s) => ({
				id: s.sessionId,
				cwd: s.cwd,
				startedAt: s.startedAt,
			}));
			reply({ type: "cc_active_sessions", data: sessions });
			return true;
		}
		case "cc_get_modified_files": {
			const sessionId = message.sessionId as string;
			const cwd = message.cwd as string | undefined;
			const files = await ctx.claudeCode.getModifiedFiles(sessionId, cwd);
			reply({ type: "cc_modified_files", data: files, sessionId });
			return true;
		}
		default:
			return false;
	}
}
