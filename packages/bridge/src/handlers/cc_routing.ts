/**
 * Claude Code (cc_*) message registrations.
 *
 * Owns every `cc_*` message type except `cc_chat` (handlers/cc_chat.ts) and
 * `cc_elicitation_response` (handlers/cc_elicitation.ts). Each type is bound
 * to exactly one sub-handler; there is no boolean chain to walk.
 */
import { registerAll, registerLegacy } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import * as ccCommands from "./cc_commands";
import * as ccConfig from "./cc_config";
import * as ccCustomTools from "./cc_custom_tools";
import * as ccHooksMcp from "./cc_hooks_mcp";
import * as ccLiveSession from "./cc_live_session";
import * as ccMemory from "./cc_memory";
import { resolveHookPermissionByToolUse } from "./cc_permission_hook";
import * as ccPlugins from "./cc_plugins";
import * as ccSessions from "./cc_sessions";
import * as ccSkills from "./cc_skills";
import * as ccSubagents from "./cc_subagents";

const SESSION_OPS = [
	"cc_list_projects",
	"cc_list_sessions",
	"cc_get_session",
	"cc_get_session_messages",
	"cc_delete_session",
	"cc_fork_session",
	"cc_rename_session",
	"cc_get_active_sessions",
	"cc_get_modified_files",
] as const;

const SKILL_OPS = ["cc_list_skills", "cc_get_skill", "cc_save_skill", "cc_delete_skill"] as const;

const COMMAND_OPS = ["cc_list_commands", "cc_get_command", "cc_save_command", "cc_delete_command"] as const;

const MEMORY_OPS = ["cc_list_memories", "cc_delete_memory", "cc_list_agents"] as const;

const CONFIG_OPS = [
	"cc_get_config",
	"cc_set_config",
	"cc_get_supported_models",
	"cc_get_account_info",
	"cc_get_mcp_server_status",
	"cc_rewind_checkpoint",
] as const;

const HOOKS_MCP_OPS = [
	"cc_list_hooks",
	"cc_hooks_file_read",
	"cc_hooks_file_write",
	"cc_mcp_file_read",
	"cc_mcp_file_write",
] as const;

const LIVE_SESSION_OPS = [
	"cc_stop_task",
	"cc_reconnect_mcp_server",
	"cc_toggle_mcp_server",
	"cc_set_permission_mode",
	"cc_set_model",
	"cc_initialization_result",
	"cc_set_mcp_servers",
	"cc_get_context_usage",
	"cc_apply_settings",
	"cc_tag_session",
	"cc_reload_plugins_live",
] as const;

const CUSTOM_TOOL_OPS = [
	"cc_list_custom_tools",
	"cc_get_custom_tool",
	"cc_save_custom_tool",
	"cc_delete_custom_tool",
	"cc_test_custom_tool",
] as const;

const PLUGIN_OPS = [
	"cc_list_plugins",
	"cc_get_plugin",
	"cc_toggle_plugin",
	"cc_add_plugin_path",
	"cc_remove_plugin_path",
	"cc_get_plugin_config",
	"cc_reload_plugins",
] as const;

const SUBAGENT_OPS = ["cc_list_subagents", "cc_get_subagent_messages"] as const;

export const MODULE_TYPES = [
	...SESSION_OPS,
	...SKILL_OPS,
	...COMMAND_OPS,
	...MEMORY_OPS,
	...CONFIG_OPS,
	...HOOKS_MCP_OPS,
	...LIVE_SESSION_OPS,
	...CUSTOM_TOOL_OPS,
	...PLUGIN_OPS,
	...SUBAGENT_OPS,
	"cc_abort",
	"cc_permission_response",
] as const;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerLegacy(router, SESSION_OPS, ccSessions.handle, () => ({
		claudeCode: deps.claudeCode,
	}));
	registerLegacy(router, SKILL_OPS, ccSkills.handle, () => ({
		claudeCode: deps.claudeCode,
		safeString: deps.safeString,
	}));
	registerLegacy(router, COMMAND_OPS, ccCommands.handle, () => ({
		claudeCode: deps.claudeCode,
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
		isSafeClaudeCommandName: deps.isSafeClaudeCommandName,
		resolveClaudeCommandFilePath: deps.resolveClaudeCommandFilePath,
	}));
	registerLegacy(router, MEMORY_OPS, ccMemory.handle, () => ({ claudeCode: deps.claudeCode }));
	registerLegacy(router, CONFIG_OPS, ccConfig.handle, () => ({ claudeCode: deps.claudeCode }));
	registerLegacy(router, HOOKS_MCP_OPS, ccHooksMcp.handle, () => ({
		claudeCode: deps.claudeCode,
		safeString: deps.safeString,
		getSecurePath: deps.getSecurePath,
	}));
	registerLegacy(router, LIVE_SESSION_OPS, ccLiveSession.handle, () => ({ claudeCode: deps.claudeCode }));
	registerLegacy(router, CUSTOM_TOOL_OPS, ccCustomTools.handle, () => undefined);
	registerLegacy(router, PLUGIN_OPS, ccPlugins.handle, () => undefined);
	registerLegacy(router, SUBAGENT_OPS, ccSubagents.handle, () => undefined);

	registerAll(router, ["cc_abort"], async (message, _ctx) => {
		await deps.claudeCode.abortClaudeCode(message.sessionId);
	});

	registerAll(router, ["cc_permission_response"], async (message, ctx) => {
		const key = `${message.sessionId}:${message.toolUseId}`;
		const waiter = deps.ccPermissionWaiters.get(key);
		if (waiter) {
			clearTimeout(waiter.timer);
			deps.ccPermissionWaiters.delete(key);
			const raw = message.response;
			const normalized: "once" | "always" | "reject" =
				raw === "once" || raw === "always" || raw === "reject" ? raw : "reject";
			const updatedInput =
				message.updatedInput && typeof message.updatedInput === "object" && !Array.isArray(message.updatedInput)
					? message.updatedInput
					: undefined;
			// SDK 0.2.87: Forward updatedPermissions for "Always Allow" rule persistence
			const updatedPermissions = Array.isArray(message.updatedPermissions) ? message.updatedPermissions : undefined;
			// SDK 0.2.87: Forward decision classification for telemetry
			const decisionClassification =
				typeof message.decisionClassification === "string" ? message.decisionClassification : undefined;
			waiter.resolve({
				response: normalized,
				...(updatedInput ? { updatedInput } : {}),
				...(updatedPermissions ? { updatedPermissions } : {}),
				...(decisionClassification ? { decisionClassification } : {}),
			});
		} else {
			// Fallback: try to resolve a hook-initiated permission request
			// (from external CC sessions using the PreToolUse hook)
			const hookResponse = message.response === "reject" ? "deny" : "allow";
			const hookUpdatedInput =
				message.updatedInput && typeof message.updatedInput === "object" && !Array.isArray(message.updatedInput)
					? message.updatedInput
					: undefined;
			resolveHookPermissionByToolUse(
				message.sessionId,
				message.toolUseId,
				hookResponse,
				typeof message.reason === "string" ? message.reason : undefined,
				hookUpdatedInput,
			);
		}
		void ctx;
	});
}
