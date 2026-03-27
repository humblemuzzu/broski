/**
 * OpenCode (oc_* and legacy) message routing.
 *
 * All OC messages were already delegated to modular handler functions
 * but the routing boilerplate (16 sequential if-calls with different
 * context shapes) lived inline in server.ts. This file consolidates
 * them into a single handle() call.
 */
import type { ServerWebSocket } from "bun";
import type { AgentType, ClientMessage, ServerMessage } from "../types";
import * as ocSessions from "./oc_sessions";
import * as ocMessages from "./oc_messages";
import * as ocWorkspaces from "./oc_workspaces";
import * as ocWorktrees from "./oc_worktrees";
import * as ocSessionOps from "./oc_session_ops";
import * as ocConfig from "./oc_config";
import * as ocProviders from "./oc_providers";
import * as ocFeatures from "./oc_features";
import * as ocFiles from "./oc_files";
import * as ocMcp from "./oc_mcp";
import * as ocChat from "./oc_chat";
import * as ocParts from "./oc_parts";
import * as ocQuestions from "./oc_questions";
import * as ocShell from "./oc_shell";
import * as ocCustomization from "./oc_customization";
import * as ocProject from "./oc_project";

type ReplyFn = (msg: ServerMessage) => void;

export type OcRoutingContext = {
	requireOpenCode: () => any;
	safeString: (v: unknown) => string;
	getSecurePath: (p: string) => Promise<string | null>;
	readFileDirectly: (filePath: string) => Promise<{ type: "text" | "binary"; content: string; mime: string; mimeType: string; encoding?: "base64" }>;
	readFileBinaryDirectly: (filePath: string, maxSizeMb?: number) => Promise<
		{ base64: string; mime: string; size: number } | { error: "not_found" | "too_large" | "access_denied"; size?: number }
	>;
	listFilesDirectly: (filePath: string) => Promise<Array<{ name: string; type: "file" | "directory"; path: string; absolute: string }>>;
	fileSearch: {
		searchFilesAndDirs: (opts: { query: string; cwd: string; limit: number; includeDirs: boolean }) => Promise<any>;
	};
	recentChatMessageIds: Map<string, number>;
	ocSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ws: ServerWebSocket<unknown>;
	syncExternalTailForKey: (key: string | null) => void;
	makeSessionKey: (agent: AgentType | undefined, sessionId: string | undefined) => string | null;
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: ReplyFn,
	ctx: OcRoutingContext,
): Promise<boolean> {
	const { requireOpenCode, safeString, getSecurePath } = ctx;

	if (await ocSessions.handle(message, reply, requireOpenCode)) return true;
	if (await ocMessages.handle(message, reply, requireOpenCode)) return true;
	if (await ocWorkspaces.handle(message, reply, requireOpenCode)) return true;
	if (await ocWorktrees.handle(message, reply, requireOpenCode)) return true;
	if (await ocSessionOps.handle(message, reply, requireOpenCode)) return true;
	if (await ocConfig.handle(message, reply, { requireOpenCode, safeString, getSecurePath })) return true;
	if (await ocProviders.handle(message, reply, requireOpenCode)) return true;
	if (await ocFeatures.handle(message, reply, requireOpenCode)) return true;
	if (
		await ocFiles.handle(message, reply, {
			requireOpenCode,
			readFileDirectly: ctx.readFileDirectly,
			readFileBinaryDirectly: ctx.readFileBinaryDirectly,
			listFilesDirectly: ctx.listFilesDirectly,
			fileSearch: ctx.fileSearch,
		})
	)
		return true;
	if (await ocMcp.handle(message, reply, requireOpenCode)) return true;
	if (
		await ocChat.handle(message, reply, {
			requireOpenCode,
			safeString,
			recentChatMessageIds: ctx.recentChatMessageIds,
			sessionOwners: ctx.ocSessionOwners,
			ws: ctx.ws,
			syncExternalTailForKey: ctx.syncExternalTailForKey,
			makeSessionKey: ctx.makeSessionKey,
		})
	)
		return true;
	if (await ocParts.handle(message, reply, requireOpenCode)) return true;
	if (await ocQuestions.handle(message, reply, requireOpenCode)) return true;
	if (await ocShell.handle(message, reply, requireOpenCode)) return true;
	if (await ocCustomization.handle(message, reply, { requireOpenCode, safeString, getSecurePath })) return true;
	if (await ocProject.handle(message, reply, requireOpenCode)) return true;

	return false;
}
