/**
 * Codex (cx_*) message routing.
 *
 * All cx_ messages were already delegated to modular handler functions
 * (cx_threads, cx_chat, cx_config, etc.) but the routing boilerplate
 * lived inline in server.ts. This file consolidates the routing.
 */
import type { ServerWebSocket } from "bun";
import type { CodexAppServerClient } from "../connectors/codex";
import type { AgentType, CodexStreamMessage, CodexThread, PermissionResponse, ServerMessage } from "../types";
import type { BroskiSessionSummary } from "../types/runtime";
import { handleCxAccount } from "./codex/cx_account";
import { handleCxAgents } from "./codex/cx_agents";
import { handleCxChat } from "./codex/cx_chat";
import { handleCxCommandPty } from "./codex/cx_command_pty";
import { handleCxConfig } from "./codex/cx_config";
import { handleCxExternalConfig } from "./codex/cx_external_config";
import { handleCxFiles } from "./codex/cx_files";
import { handleCxMcp } from "./codex/cx_mcp";
import { handleCxPlugins } from "./codex/cx_plugins";
import { handleCxSkills } from "./codex/cx_skills";
import { handleCxThreads } from "./codex/cx_threads";
import { handleCodexFeature } from "./codex_features";

type ReplyFn = (msg: ServerMessage) => void;

type CxProjectCacheEntry = { fetchedAt: number; data: unknown[] };
type CxThreadCacheEntry = { fetchedAt: number; data: CodexThread[]; nextCursor: string | null };

export type CxRoutingContext = {
	ws: ServerWebSocket<unknown>;
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	codexClient: CodexAppServerClient | null;
	codexFs: typeof import("../connectors/codex-fs");
	safeString: (v: unknown) => string;
	getSecurePath: (p: string) => Promise<string | null>;
	logInfo: (msg: string) => void;
	logError: (msg: string, ...args: unknown[]) => void;
	logDebug: (msg: string) => void;
	DEBUG_CX_GLOBAL: boolean;
	send: (ws: ServerWebSocket<unknown>, msg: ServerMessage) => void;
	broadcastToSessionWatchers: (
		agent: AgentType,
		sessionId: string,
		msg: ServerMessage,
		excludeWs?: ServerWebSocket<unknown>,
	) => void;
	// Thread state
	cxProjectCache: CxProjectCacheEntry | null;
	setProjectCache: (cache: CxProjectCacheEntry | null) => void;
	cxThreadCache: Map<string, CxThreadCacheEntry>;
	CODEX_PROJECT_CACHE_TTL_MS: number;
	CODEX_THREAD_CACHE_TTL_MS: number;
	cxThreadNames: Map<string, string>;
	cxThreadOwners: Map<string, ServerWebSocket<unknown>>;
	cxThreadCwds: Map<string, string>;
	cxActiveTurns: Map<string, string>;
	cxApprovalWaiters: Map<
		string,
		{
			resolve: (response: {
				response?: PermissionResponse;
				execpolicyAmendment?: unknown;
				networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
				answers?: Record<string, { answers: string[] }>;
			}) => void;
			timer: Timer;
		}
	>;
	mapCodexThread: (thread: unknown, nameOverride?: string) => CodexThread & { threadName?: string };
	mapCodexThreadToRuntimeSession: (thread: CodexThread) => BroskiSessionSummary;
	invalidateCodexCaches: (cwd?: string) => void;
	buildCodexRuntimeState: (params: { threadId: string; cwd?: string; isStreaming: boolean }) => Record<string, unknown>;
	emitCxStream: (threadId: string, streamMsg: CodexStreamMessage, owner?: ServerWebSocket<unknown> | null) => void;
	// File undo
	ensureUndoStack: (threadId: string) => string[];
	applyCodexUndo: (threadId: string, key: string) => Promise<string[]>;
};

const THREAD_OPS = new Set([
	"cx_list_projects",
	"cx_list_threads",
	"cx_warmup",
	"cx_start_thread",
	"cx_resume_thread",
	"cx_archive_thread",
	"cx_thread_fork",
	"cx_thread_rollback",
]);

const FILE_OPS = new Set(["cx_get_thread_messages", "cx_undo_files"]);

const CONFIG_OPS = new Set(["cx_model_list", "cx_config_read", "cx_config_value_write"]);

const EXT_CONFIG_OPS = new Set(["cx_external_config_detect", "cx_external_config_import"]);

const SKILL_OPS = new Set(["cx_skills_list", "cx_get_skill", "cx_save_skill", "cx_delete_skill", "cx_list_prompts"]);

const MCP_OPS = new Set(["cx_mcp_status_list", "cx_mcp_reload", "cx_review_start"]);

const ACCOUNT_OPS = new Set([
	"cx_account_read",
	"cx_login_start",
	"cx_login_cancel",
	"cx_logout",
	"cx_rate_limits_read",
	"cx_feedback_upload",
]);

const AGENT_OPS = new Set(["cx_agents_read", "cx_agents_write"]);

const CHAT_OPS = new Set(["cx_chat", "cx_abort", "cx_permission_response", "cx_user_input_response"]);

const PLUGIN_OPS = new Set(["cx_plugin_list", "cx_plugin_install", "cx_plugin_uninstall"]);

const CMD_PTY_OPS = new Set([
	"cx_command_write",
	"cx_command_resize",
	"cx_command_terminate",
	"cx_thread_metadata_update",
]);

const FEATURE_OPS = new Set([
	"cx_steer",
	"cx_thread_rename",
	"cx_thread_unarchive",
	"cx_thread_compact",
	"cx_remote_skills_list",
	"cx_remote_skill_install",
	"cx_skill_config_write",
	"cx_apps_list",
	"cx_command_exec",
	"cx_experimental_features",
	"cx_config_batch_write",
	"cx_config_requirements_read",
	"cx_thread_loaded_list",
	"cx_thread_read",
	"cx_mcp_oauth_login",
	"cx_thread_unsubscribe",
	"cx_collaboration_modes",
	"cx_background_terminals_clean",
]);

export async function handle(
	message: Record<string, unknown>,
	reply: ReplyFn,
	ctx: CxRoutingContext,
): Promise<boolean> {
	const type = message.type as string;
	if (!type.startsWith("cx_")) return false;

	if (THREAD_OPS.has(type)) {
		const handled = await handleCxThreads(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			codexClient: ctx.codexClient,
			codexFs: ctx.codexFs,
			safeString: ctx.safeString,
			getSecurePath: ctx.getSecurePath,
			logInfo: ctx.logInfo,
			logError: ctx.logError,
			cxProjectCache: ctx.cxProjectCache,
			setProjectCache: ctx.setProjectCache,
			cxThreadCache: ctx.cxThreadCache,
			CODEX_PROJECT_CACHE_TTL_MS: ctx.CODEX_PROJECT_CACHE_TTL_MS,
			CODEX_THREAD_CACHE_TTL_MS: ctx.CODEX_THREAD_CACHE_TTL_MS,
			cxThreadNames: ctx.cxThreadNames,
			cxThreadOwners: ctx.cxThreadOwners,
			cxThreadCwds: ctx.cxThreadCwds,
			mapCodexThread: ctx.mapCodexThread,
			mapCodexThreadToRuntimeSession: ctx.mapCodexThreadToRuntimeSession,
			invalidateCodexCaches: ctx.invalidateCodexCaches,
			ws: ctx.ws,
		});
		if (!handled) reply({ type: "error", message: `Unhandled thread feature: ${type}` });
		return true;
	}

	if (FILE_OPS.has(type)) {
		const handled = await handleCxFiles(message, reply, {
			safeString: ctx.safeString,
			logInfo: ctx.logInfo,
			logError: ctx.logError,
			codexFs: ctx.codexFs,
			codexClient: ctx.codexClient,
			ensureUndoStack: ctx.ensureUndoStack,
			applyCodexUndo: ctx.applyCodexUndo,
		});
		if (!handled) reply({ type: "error", message: `Unhandled files feature: ${type}` });
		return true;
	}

	if (CONFIG_OPS.has(type)) {
		const handled = await handleCxConfig(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled config feature: ${type}` });
		return true;
	}

	if (EXT_CONFIG_OPS.has(type)) {
		const handled = await handleCxExternalConfig(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled external config feature: ${type}` });
		return true;
	}

	if (SKILL_OPS.has(type)) {
		const handled = await handleCxSkills(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled skills feature: ${type}` });
		return true;
	}

	if (MCP_OPS.has(type)) {
		const handled = await handleCxMcp(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
			cxThreadOwners: ctx.cxThreadOwners,
			cxThreadCwds: ctx.cxThreadCwds,
			cxActiveTurns: ctx.cxActiveTurns,
			mapCodexThread: ctx.mapCodexThread,
			ws: ctx.ws,
		});
		if (!handled) reply({ type: "error", message: `Unhandled MCP feature: ${type}` });
		return true;
	}

	if (ACCOUNT_OPS.has(type)) {
		const handled = await handleCxAccount(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
		});
		if (!handled) reply({ type: "error", message: `Unhandled account feature: ${type}` });
		return true;
	}

	if (AGENT_OPS.has(type)) {
		const handled = await handleCxAgents(message, reply, {
			safeString: ctx.safeString,
			getSecurePath: ctx.getSecurePath,
		});
		if (!handled) reply({ type: "error", message: `Unhandled agents feature: ${type}` });
		return true;
	}

	if (CHAT_OPS.has(type)) {
		const handled = await handleCxChat(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
			logInfo: ctx.logInfo,
			logError: ctx.logError,
			logDebug: ctx.logDebug,
			DEBUG_CX_GLOBAL: ctx.DEBUG_CX_GLOBAL,
			cxThreadOwners: ctx.cxThreadOwners,
			cxThreadCwds: ctx.cxThreadCwds,
			cxActiveTurns: ctx.cxActiveTurns,
			cxApprovalWaiters: ctx.cxApprovalWaiters,
			mapCodexThread: ctx.mapCodexThread,
			emitCxStream: ctx.emitCxStream,
			send: ctx.send,
			broadcastToSessionWatchers: ctx.broadcastToSessionWatchers,
			buildCodexRuntimeState: ctx.buildCodexRuntimeState,
			ws: ctx.ws,
		});
		if (!handled) reply({ type: "error", message: `Unhandled chat feature: ${type}` });
		return true;
	}

	if (PLUGIN_OPS.has(type)) {
		const handled = await handleCxPlugins(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled plugin feature: ${type}` });
		return true;
	}

	if (FEATURE_OPS.has(type)) {
		const handled = await handleCodexFeature(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			cxActiveTurns: ctx.cxActiveTurns,
			cxThreadNames: ctx.cxThreadNames,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled Codex feature: ${type}` });
		return true;
	}

	if (CMD_PTY_OPS.has(type)) {
		const handled = await handleCxCommandPty(message, reply, {
			ensureCodexClient: ctx.ensureCodexClient,
			safeString: ctx.safeString,
		});
		if (!handled) reply({ type: "error", message: `Unhandled command: ${type}` });
		return true;
	}

	return false;
}
