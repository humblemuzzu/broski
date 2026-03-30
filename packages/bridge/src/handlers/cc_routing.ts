/**
 * Claude Code (cc_*) message routing.
 *
 * All cc_ messages were already delegated to modular handler functions
 * (cc_sessions, cc_config, cc_skills, etc.) but the routing boilerplate
 * lived inline in server.ts. This file consolidates the routing,
 * following the same pattern as cx_routing.ts.
 */
import type { ClaudeCodeSupportedModel, ServerMessage } from "../types";
import type { BroskiModelSummary, BroskiSessionSummary } from "../types/runtime";
import * as ccCommands from "./cc_commands";
import * as ccConfig from "./cc_config";
import * as ccCustomTools from "./cc_custom_tools";
import * as ccHooksMcp from "./cc_hooks_mcp";
import * as ccLiveSession from "./cc_live_session";
import * as ccMemory from "./cc_memory";
import * as ccPlugins from "./cc_plugins";
import * as ccSessions from "./cc_sessions";
import * as ccSkills from "./cc_skills";

type ReplyFn = (msg: ServerMessage) => void;

export type CcRoutingContext = {
	claudeCode: typeof import("../connectors/claude-code");
	mapClaudeCodeSessionToRuntimeSession: (session: any) => BroskiSessionSummary;
	mapClaudeCodeModelToSummary: (model: ClaudeCodeSupportedModel) => BroskiModelSummary;
	safeString: (value: unknown) => string;
	getSecurePath: (path: string) => Promise<string | null>;
	isSafeClaudeCommandName: (name: string) => boolean;
	resolveClaudeCommandFilePath: (params: { cwd: string; source: "project" | "user"; name: string }) => string | null;
	ccPermissionWaiters: Map<
		string,
		{
			resolve: (response: {
				response: "once" | "always" | "reject";
				updatedInput?: Record<string, unknown>;
				updatedPermissions?: unknown[];
				decisionClassification?: string;
			}) => void;
			timer: Timer;
		}
	>;
};

const SESSION_OPS = new Set([
	"cc_list_projects",
	"cc_list_sessions",
	"cc_get_session",
	"cc_get_session_messages",
	"cc_delete_session",
	"cc_fork_session",
	"cc_rename_session",
	"cc_background_session",
	"cc_get_active_sessions",
]);

const SKILL_OPS = new Set(["cc_list_skills", "cc_get_skill", "cc_save_skill", "cc_delete_skill"]);

const COMMAND_OPS = new Set(["cc_list_commands", "cc_get_command", "cc_save_command", "cc_delete_command"]);

const MEMORY_OPS = new Set(["cc_list_memories", "cc_delete_memory", "cc_list_agents"]);

const CONFIG_OPS = new Set([
	"cc_get_config",
	"cc_set_config",
	"cc_get_supported_models",
	"cc_get_account_info",
	"cc_get_mcp_server_status",
	"cc_rewind_checkpoint",
]);

const HOOKS_MCP_OPS = new Set([
	"cc_list_hooks",
	"cc_hooks_file_read",
	"cc_hooks_file_write",
	"cc_mcp_file_read",
	"cc_mcp_file_write",
]);

const LIVE_SESSION_OPS = new Set([
	"cc_stop_task",
	"cc_reconnect_mcp_server",
	"cc_toggle_mcp_server",
	"cc_set_permission_mode",
	"cc_set_model",
	"cc_initialization_result",
	"cc_set_mcp_servers",
	// SDK 0.2.87
	"cc_get_context_usage",
	"cc_apply_settings",
	"cc_tag_session",
	"cc_reload_plugins_live",
]);

const CUSTOM_TOOL_OPS = new Set([
	"cc_list_custom_tools",
	"cc_get_custom_tool",
	"cc_save_custom_tool",
	"cc_delete_custom_tool",
	"cc_test_custom_tool",
]);

const PLUGIN_OPS = new Set([
	"cc_list_plugins",
	"cc_get_plugin",
	"cc_toggle_plugin",
	"cc_add_plugin_path",
	"cc_remove_plugin_path",
	"cc_get_plugin_config",
	"cc_reload_plugins",
]);

export async function handle(
	message: Record<string, unknown>,
	reply: ReplyFn,
	ctx: CcRoutingContext,
): Promise<boolean> {
	const type = message.type as string;
	if (!type.startsWith("cc_")) return false;

	if (SESSION_OPS.has(type)) {
		const ccSessionCtx = {
			claudeCode: ctx.claudeCode,
			mapClaudeCodeSessionToRuntimeSession: ctx.mapClaudeCodeSessionToRuntimeSession,
		};
		if (await ccSessions.handle(message, reply, ccSessionCtx)) return true;
		reply({ type: "error", message: "Unhandled CC session message" });
		return true;
	}

	if (SKILL_OPS.has(type)) {
		const ccSkillCtx = { claudeCode: ctx.claudeCode, safeString: ctx.safeString };
		if (await ccSkills.handle(message, reply, ccSkillCtx)) return true;
		reply({ type: "error", message: "Unhandled CC skill message" });
		return true;
	}

	if (COMMAND_OPS.has(type)) {
		const ccCmdCtx = {
			claudeCode: ctx.claudeCode,
			safeString: ctx.safeString,
			getSecurePath: ctx.getSecurePath,
			isSafeClaudeCommandName: ctx.isSafeClaudeCommandName,
			resolveClaudeCommandFilePath: ctx.resolveClaudeCommandFilePath,
		};
		if (await ccCommands.handle(message, reply, ccCmdCtx)) return true;
		reply({ type: "error", message: "Unhandled CC command message" });
		return true;
	}

	if (MEMORY_OPS.has(type)) {
		const ccMemCtx = { claudeCode: ctx.claudeCode };
		if (await ccMemory.handle(message, reply, ccMemCtx)) return true;
		reply({ type: "error", message: "Unhandled CC memory/agent message" });
		return true;
	}

	if (CONFIG_OPS.has(type)) {
		const ccCfgCtx = { claudeCode: ctx.claudeCode, mapClaudeCodeModelToSummary: ctx.mapClaudeCodeModelToSummary };
		if (await ccConfig.handle(message, reply, ccCfgCtx)) return true;
		reply({ type: "error", message: "Unhandled CC config message" });
		return true;
	}

	if (HOOKS_MCP_OPS.has(type)) {
		const ccHooksCtx = { claudeCode: ctx.claudeCode, safeString: ctx.safeString, getSecurePath: ctx.getSecurePath };
		if (await ccHooksMcp.handle(message, reply, ccHooksCtx)) return true;
		reply({ type: "error", message: "Unhandled CC hooks/MCP message" });
		return true;
	}

	if (LIVE_SESSION_OPS.has(type)) {
		const ccLiveCtx = { claudeCode: ctx.claudeCode };
		if (await ccLiveSession.handle(message, reply, ccLiveCtx)) return true;
		reply({ type: "error", message: "Unhandled CC live session message" });
		return true;
	}

	if (CUSTOM_TOOL_OPS.has(type)) {
		if (await ccCustomTools.handle(message, reply)) return true;
		reply({ type: "error", message: "Unhandled CC custom tools message" });
		return true;
	}

	if (PLUGIN_OPS.has(type)) {
		if (await ccPlugins.handle(message, reply)) return true;
		reply({ type: "error", message: "Unhandled CC plugins message" });
		return true;
	}

	// cc_abort — direct inline handler (too small to justify its own handler file)
	if (type === "cc_abort") {
		await ctx.claudeCode.abortClaudeCode(message.sessionId as string);
		return true;
	}

	// cc_permission_response — resolves permission prompts
	if (type === "cc_permission_response") {
		const key = `${message.sessionId}:${message.toolUseId}`;
		const waiter = ctx.ccPermissionWaiters.get(key);
		if (waiter) {
			clearTimeout(waiter.timer);
			ctx.ccPermissionWaiters.delete(key);
			const raw = message.response;
			const normalized: "once" | "always" | "reject" =
				raw === "once" || raw === "always" || raw === "reject" ? raw : "reject";
			const updatedInput =
				message.updatedInput && typeof message.updatedInput === "object" && !Array.isArray(message.updatedInput)
					? (message.updatedInput as Record<string, unknown>)
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
		}
		return true;
	}

	return false;
}
