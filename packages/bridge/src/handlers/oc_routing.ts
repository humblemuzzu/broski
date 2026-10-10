/**
 * OpenCode (oc_* and legacy unprefixed) message registrations.
 *
 * Each type is bound to exactly one sub-handler, mirroring the order the
 * previous boolean chain tried them in. `oc_delete_message` / `oc_get_message`
 * used to be matched by both oc_messages and oc_parts; oc_messages won because
 * it ran first, so oc_parts no longer claims them.
 */
import { registerLegacy } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import * as ocChat from "./oc_chat";
import * as ocConfig from "./oc_config";
import * as ocCustomization from "./oc_customization";
import * as ocFeatures from "./oc_features";
import * as ocFiles from "./oc_files";
import * as ocMcp from "./oc_mcp";
import * as ocMessages from "./oc_messages";
import * as ocParts from "./oc_parts";
import * as ocProject from "./oc_project";
import * as ocProviders from "./oc_providers";
import * as ocQuestions from "./oc_questions";
import * as ocSessionOps from "./oc_session_ops";
import * as ocSessions from "./oc_sessions";
import * as ocShell from "./oc_shell";
import * as ocUpgrade from "./oc_upgrade";
import * as ocWorkspaces from "./oc_workspaces";
import * as ocWorktrees from "./oc_worktrees";

const SESSIONS = ["list_sessions"] as const;

const MESSAGES = ["oc_delete_message", "oc_get_message"] as const;

const WORKSPACES = ["oc_list_workspaces", "oc_create_workspace", "oc_remove_workspace"] as const;

const WORKTREES = ["list_worktrees", "create_worktree", "reset_worktree", "delete_worktree"] as const;

const SESSION_OPS = [
	"create_session",
	"get_session",
	"get_session_messages",
	"delete_session",
	"update_session",
	"fork_session",
	"session_children",
	"revert_message",
	"unrevert_session",
	"share_session",
	"unshare_session",
	"summarize_session",
	"init_session",
	"diff",
	"get_session_context",
] as const;

const CONFIG_OPS = ["get_config", "set_config", "set_model", "get_global_config", "set_global_config"] as const;

const PROVIDER_OPS = [
	"list_providers",
	"list_all_providers",
	"get_provider_auth",
	"provider_oauth_authorize",
	"provider_oauth_callback",
	"auth_set",
	"auth_remove",
] as const;

const FEATURE_OPS = [
	"list_projects",
	"get_todos",
	"list_commands",
	"execute_command",
	"list_agents",
	"get_vcs",
	"get_vcs_diff",
	"get_lsp_status",
	"get_formatter_status",
	"list_tool_ids",
	"list_tools",
	"get_session_status",
	"dispose_instance",
	"get_current_project",
	"update_project",
	"list_pending_permissions",
	"list_pending_questions",
	"oc_list_sdk_skills",
] as const;

const FILE_OPS = [
	"read_file",
	"read_file_binary",
	"browse",
	"find_files",
	"find_text",
	"find_symbols",
	"search_files_and_dirs",
	"get_file_status",
] as const;

const MCP_OPS = [
	"get_mcp_status",
	"add_mcp",
	"connect_mcp",
	"disconnect_mcp",
	"get_mcp_resources",
	"mcp_auth_start",
	"mcp_auth_callback",
	"mcp_auth_authenticate",
	"mcp_auth_remove",
] as const;

const CHAT_OPS = ["chat", "abort", "permission_response"] as const;

const PART_OPS = ["delete_part", "update_part"] as const;

const QUESTION_OPS = ["oc_question_reply", "oc_question_reject"] as const;

const SHELL_OPS = ["oc_session_shell"] as const;

const CUSTOMIZATION_OPS = [
	"oc_list_skills",
	"oc_get_skill",
	"oc_save_skill",
	"oc_delete_skill",
	"oc_list_plugin_files",
	"oc_get_plugin_file",
	"oc_save_plugin_file",
	"oc_delete_plugin_file",
	"oc_list_command_files",
	"oc_get_command_file",
	"oc_save_command_file",
	"oc_delete_command_file",
	"oc_list_agent_files",
	"oc_get_agent_file",
	"oc_save_agent_file",
	"oc_delete_agent_file",
] as const;

const PROJECT_OPS = ["oc_init_git", "oc_get_paths"] as const;

const UPGRADE_OPS = ["oc_health"] as const;

export const MODULE_TYPES = [
	...SESSIONS,
	...MESSAGES,
	...WORKSPACES,
	...WORKTREES,
	...SESSION_OPS,
	...CONFIG_OPS,
	...PROVIDER_OPS,
	...FEATURE_OPS,
	...FILE_OPS,
	...MCP_OPS,
	...CHAT_OPS,
	...PART_OPS,
	...QUESTION_OPS,
	...SHELL_OPS,
	...CUSTOMIZATION_OPS,
	...PROJECT_OPS,
	...UPGRADE_OPS,
] as const;

export function register(router: MessageRouter, deps: ServerDeps): void {
	const requireOpenCode = () => deps.requireOpenCode();
	const buildRequireOpenCode = () => requireOpenCode;

	registerLegacy(router, SESSIONS, ocSessions.handle, buildRequireOpenCode);
	registerLegacy(router, MESSAGES, ocMessages.handle, buildRequireOpenCode);
	registerLegacy(router, WORKSPACES, ocWorkspaces.handle, buildRequireOpenCode);
	registerLegacy(router, WORKTREES, ocWorktrees.handle, buildRequireOpenCode);
	registerLegacy(router, SESSION_OPS, ocSessionOps.handle, buildRequireOpenCode);
	registerLegacy(router, CONFIG_OPS, ocConfig.handle, () => ({
		requireOpenCode,
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
	}));
	registerLegacy(router, PROVIDER_OPS, ocProviders.handle, buildRequireOpenCode);
	registerLegacy(router, FEATURE_OPS, ocFeatures.handle, buildRequireOpenCode);
	registerLegacy(router, FILE_OPS, ocFiles.handle, () => ({
		requireOpenCode,
		readFileDirectly: deps.readFileDirectly,
		readFileBinaryDirectly: deps.readFileBinaryDirectly,
		listFilesDirectly: deps.listFilesDirectly,
		fileSearch: deps.fileSearch,
	}));
	registerLegacy(router, MCP_OPS, ocMcp.handle, buildRequireOpenCode);
	registerLegacy(router, CHAT_OPS, ocChat.handle, (ctx) => ({
		requireOpenCode,
		safeString: deps.safeString,
		recentChatMessageIds: deps.recentChatMessageIds,
		sessionOwners: deps.ocSessionOwners,
		ws: ctx.ws,
		syncExternalTailForKey: deps.syncExternalTailForKey,
		makeSessionKey: deps.makeSessionKey,
	}));
	registerLegacy(router, PART_OPS, ocParts.handle, buildRequireOpenCode);
	registerLegacy(router, QUESTION_OPS, ocQuestions.handle, buildRequireOpenCode);
	registerLegacy(router, SHELL_OPS, ocShell.handle, buildRequireOpenCode);
	registerLegacy(router, CUSTOMIZATION_OPS, ocCustomization.handle, () => ({
		requireOpenCode,
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
	}));
	registerLegacy(router, PROJECT_OPS, ocProject.handle, buildRequireOpenCode);
	registerLegacy(router, UPGRADE_OPS, ocUpgrade.handle, buildRequireOpenCode);
}
