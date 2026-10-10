/**
 * Codex (cx_*) message registrations.
 *
 * Every `cx_*` type is bound to exactly one sub-handler. The previous boolean
 * chain's `if (!handled) reply(...)` fallbacks were unreachable — each group's
 * type set matched its sub-handler's cases exactly — so they are gone.
 */
import { registerLegacy } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import { handleCxAccount } from "./codex/cx_account";
import { handleCxAgents } from "./codex/cx_agents";
import { handleCxChat } from "./codex/cx_chat";
import { handleCxCommandPty } from "./codex/cx_command_pty";
import { handleCxConfig } from "./codex/cx_config";
import { handleCxExternalConfig } from "./codex/cx_external_config";
import { handleCxFiles } from "./codex/cx_files";
import * as cxFsWatch from "./codex/cx_fs_watch";
import * as cxFuzzySearch from "./codex/cx_fuzzy_search";
import { handleCxMcp } from "./codex/cx_mcp";
import { handleCxPlugins } from "./codex/cx_plugins";
import { handleCxSkills } from "./codex/cx_skills";
import { handleCxThreads } from "./codex/cx_threads";
import * as cxWorkspace from "./codex/cx_workspace";
import { handleCodexFeature } from "./codex_features";

/** Socket teardown for `cx_fs_watch` subscriptions, which the router owns the socket for. */
export { detach as detachCxFsWatches } from "./codex/cx_fs_watch";

const THREAD_OPS = [
	"cx_list_projects",
	"cx_list_threads",
	"cx_warmup",
	"cx_start_thread",
	"cx_resume_thread",
	"cx_archive_thread",
	"cx_thread_fork",
	"cx_thread_rollback",
	"cx_thread_unsubscribe",
] as const;
const FILE_OPS = ["cx_get_thread_messages", "cx_undo_files", "cx_get_modified_files"] as const;
const CONFIG_OPS = ["cx_model_list", "cx_config_read", "cx_config_value_write"] as const;
const EXT_CONFIG_OPS = ["cx_external_config_detect", "cx_external_config_import"] as const;
const SKILL_OPS = ["cx_skills_list", "cx_get_skill", "cx_save_skill", "cx_delete_skill", "cx_list_prompts"] as const;
const MCP_OPS = ["cx_mcp_status_list", "cx_mcp_reload", "cx_review_start"] as const;
const ACCOUNT_OPS = [
	"cx_account_read",
	"cx_login_start",
	"cx_login_cancel",
	"cx_logout",
	"cx_rate_limits_read",
	"cx_feedback_upload",
] as const;
const AGENT_OPS = ["cx_agents_read", "cx_agents_write"] as const;
const CHAT_OPS = ["cx_chat", "cx_abort", "cx_permission_response", "cx_user_input_response"] as const;
const PLUGIN_OPS = ["cx_plugin_list", "cx_plugin_install", "cx_plugin_uninstall", "cx_plugin_read"] as const;
const CMD_PTY_OPS = [
	"cx_command_write",
	"cx_command_resize",
	"cx_command_terminate",
	"cx_thread_metadata_update",
] as const;
const WORKSPACE_OPS = ["cx_revert_changes", "cx_get_turn_diff"] as const;
const FUZZY_SEARCH_OPS = ["cx_fuzzy_search_start", "cx_fuzzy_search_update", "cx_fuzzy_search_end"] as const;
const FS_WATCH_OPS = ["cx_fs_watch", "cx_fs_unwatch"] as const;
const FEATURE_OPS = [
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
	"cx_collaboration_modes",
	"cx_background_terminals_clean",
	"cx_shell_command",
] as const;

export const MODULE_TYPES = [
	...THREAD_OPS,
	...FILE_OPS,
	...CONFIG_OPS,
	...EXT_CONFIG_OPS,
	...SKILL_OPS,
	...MCP_OPS,
	...ACCOUNT_OPS,
	...AGENT_OPS,
	...CHAT_OPS,
	...PLUGIN_OPS,
	...CMD_PTY_OPS,
	...WORKSPACE_OPS,
	...FUZZY_SEARCH_OPS,
	...FS_WATCH_OPS,
	...FEATURE_OPS,
] as const;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerLegacy(router, THREAD_OPS, handleCxThreads, (ctx) => ({
		ensureCodexClient: deps.ensureCodexClient,
		codexClient: deps.codexClient,
		codexFs: deps.codexFs,
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
		logInfo: deps.logInfo,
		logError: deps.logError,
		cxProjectCache: deps.cxProjectCache,
		setProjectCache: deps.setProjectCache,
		cxThreadCache: deps.cxThreadCache,
		CODEX_PROJECT_CACHE_TTL_MS: deps.CODEX_PROJECT_CACHE_TTL_MS,
		CODEX_THREAD_CACHE_TTL_MS: deps.CODEX_THREAD_CACHE_TTL_MS,
		cxThreadNames: deps.cxThreadNames,
		cxThreadOwners: deps.cxThreadOwners,
		cxThreadCwds: deps.cxThreadCwds,
		mapCodexThread: deps.mapCodexThread,
		mapCodexThreadToRuntimeSession: deps.mapCodexThreadToRuntimeSession,
		invalidateCodexCaches: deps.invalidateCodexCaches,
		ws: ctx.ws,
	}));
	registerLegacy(router, FILE_OPS, handleCxFiles, () => ({
		safeString: deps.safeString,
		logInfo: deps.logInfo,
		logError: deps.logError,
		codexFs: deps.codexFs,
		codexClient: deps.codexClient,
		ensureUndoStack: deps.ensureUndoStack,
		applyCodexUndo: deps.applyCodexUndo,
	}));
	registerLegacy(router, CONFIG_OPS, handleCxConfig, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
	registerLegacy(router, EXT_CONFIG_OPS, handleCxExternalConfig, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
	registerLegacy(router, SKILL_OPS, handleCxSkills, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
	registerLegacy(router, MCP_OPS, handleCxMcp, (ctx) => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
		cxThreadOwners: deps.cxThreadOwners,
		cxThreadCwds: deps.cxThreadCwds,
		cxActiveTurns: deps.cxActiveTurns,
		mapCodexThread: deps.mapCodexThread,
		ws: ctx.ws,
	}));
	registerLegacy(router, ACCOUNT_OPS, handleCxAccount, () => ({ ensureCodexClient: deps.ensureCodexClient }));
	registerLegacy(router, AGENT_OPS, handleCxAgents, () => ({
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
	}));
	registerLegacy(router, CHAT_OPS, handleCxChat, (ctx) => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
		logInfo: deps.logInfo,
		logError: deps.logError,
		logDebug: deps.logDebug,
		DEBUG_CX_GLOBAL: deps.DEBUG_CX_GLOBAL,
		cxThreadOwners: deps.cxThreadOwners,
		cxThreadCwds: deps.cxThreadCwds,
		cxActiveTurns: deps.cxActiveTurns,
		cxApprovalWaiters: deps.cxApprovalWaiters,
		mapCodexThread: deps.mapCodexThread,
		emitCxStream: deps.emitCxStream,
		send: deps.send,
		broadcastToSessionWatchers: deps.broadcastToSessionWatchers,
		buildCodexRuntimeState: deps.buildCodexRuntimeState,
		ws: ctx.ws,
	}));
	registerLegacy(router, PLUGIN_OPS, handleCxPlugins, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
	registerLegacy(router, FEATURE_OPS, handleCodexFeature, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		cxActiveTurns: deps.cxActiveTurns,
		cxThreadNames: deps.cxThreadNames,
		safeString: deps.safeString,
	}));
	registerLegacy(router, WORKSPACE_OPS, cxWorkspace.handle, () => ({
		safeString: deps.safeString,
		cxThreadCwds: deps.cxThreadCwds,
	}));
	registerLegacy(router, CMD_PTY_OPS, handleCxCommandPty, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
	registerLegacy(router, FUZZY_SEARCH_OPS, cxFuzzySearch.handle, () => ({
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
		cxThreadCwds: deps.cxThreadCwds,
		cxSearchSessions: deps.cxSearchSessions,
	}));
	registerLegacy(router, FS_WATCH_OPS, cxFsWatch.handle, (ctx) => ({
		ws: ctx.ws,
		ensureCodexClient: deps.ensureCodexClient,
		safeString: deps.safeString,
	}));
}
