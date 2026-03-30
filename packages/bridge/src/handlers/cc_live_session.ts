import type { ClaudeCodePermissionMode, ServerMessage } from "../types";

type ReplyFn = (msg: ServerMessage) => void;

type HandlerContext = {
	claudeCode: {
		stopTask: (sessionId: string, taskId: string) => Promise<boolean>;
		reconnectMcpServer: (sessionId: string, serverName: string) => Promise<boolean>;
		toggleMcpServer: (sessionId: string, serverName: string, enabled: boolean) => Promise<boolean>;
		setPermissionMode: (sessionId: string, mode: string) => Promise<boolean>;
		setModel: (sessionId: string, model: string) => Promise<boolean>;
		getInitializationResult: (sessionId: string) => Promise<Record<string, unknown> | null>;
		setMcpServers: (
			sessionId: string,
			servers: Record<string, unknown>,
		) => Promise<{ added: string[]; removed: string[]; errors: Record<string, string> } | null>;
		// SDK 0.2.87
		getContextUsage: (sessionId: string) => Promise<Record<string, unknown> | null>;
		applySettings: (sessionId: string, settings: Record<string, unknown>) => Promise<boolean>;
		tagSession: (sessionId: string, tag: string | null, cwd?: string) => Promise<boolean>;
		reloadPluginsLive: (sessionId: string) => Promise<{
			commands: unknown[];
			agents: unknown[];
			plugins: unknown[];
			mcpServers: unknown[];
			errorCount: number;
		} | null>;
	};
};

export async function handle(message: Record<string, unknown>, reply: ReplyFn, ctx: HandlerContext): Promise<boolean> {
	const type = message.type as string;
	switch (type) {
		case "cc_stop_task": {
			const taskId = message.taskId as string;
			const ok = await ctx.claudeCode.stopTask(message.sessionId as string, taskId);
			reply({
				type: "cc_task_stopped",
				data: { ok, taskId },
			});
			return true;
		}
		case "cc_reconnect_mcp_server": {
			const serverName = message.serverName as string;
			const ok = await ctx.claudeCode.reconnectMcpServer(message.sessionId as string, serverName);
			reply({
				type: "cc_mcp_server_reconnected",
				data: { ok, serverName },
			});
			return true;
		}
		case "cc_toggle_mcp_server": {
			const serverName = message.serverName as string;
			const enabled = message.enabled as boolean;
			const ok = await ctx.claudeCode.toggleMcpServer(message.sessionId as string, serverName, enabled);
			reply({
				type: "cc_mcp_server_toggled",
				data: {
					ok,
					serverName,
					enabled,
				},
			});
			return true;
		}
		case "cc_set_permission_mode": {
			const mode = message.mode as ClaudeCodePermissionMode;
			const ok = await ctx.claudeCode.setPermissionMode(message.sessionId as string, mode);
			reply({
				type: "cc_permission_mode_set",
				data: { ok, mode },
			});
			return true;
		}
		case "cc_set_model": {
			const model = message.model as string | undefined;
			const ok = await ctx.claudeCode.setModel(message.sessionId as string, model ?? "");
			reply({ type: "cc_model_set", data: { ok, model } });
			return true;
		}
		case "cc_initialization_result": {
			const result = await ctx.claudeCode.getInitializationResult(message.sessionId as string);
			reply({ type: "cc_initialization_result", data: result });
			return true;
		}
		case "cc_set_mcp_servers": {
			const result = await ctx.claudeCode.setMcpServers(
				message.sessionId as string,
				message.servers as Record<string, unknown>,
			);
			reply({ type: "cc_mcp_servers_set", data: result });
			return true;
		}
		// SDK 0.2.87: Context usage breakdown
		case "cc_get_context_usage": {
			const reqId = typeof message.requestId === "string" ? message.requestId : undefined;
			try {
				const data = await ctx.claudeCode.getContextUsage(message.sessionId as string);
				reply({
					type: "cc_context_usage",
					data,
					requestId: reqId,
				});
			} catch (err: unknown) {
				reply({
					type: "cc_context_usage",
					data: null,
					error: err instanceof Error ? err.message : "Unknown error",
					requestId: reqId,
				});
			}
			return true;
		}
		// SDK 0.2.87: Apply settings mid-session
		case "cc_apply_settings": {
			const reqId = typeof message.requestId === "string" ? message.requestId : undefined;
			try {
				const ok = await ctx.claudeCode.applySettings(
					message.sessionId as string,
					message.settings as Record<string, unknown>,
				);
				reply({
					type: "cc_settings_applied",
					data: { ok },
					requestId: reqId,
				});
			} catch (err: unknown) {
				reply({
					type: "cc_settings_applied",
					data: { ok: false },
					error: err instanceof Error ? err.message : "Unknown error",
					requestId: reqId,
				});
			}
			return true;
		}
		// SDK 0.2.87: Reload plugins on live session (Query method, not filesystem scan)
		case "cc_reload_plugins_live": {
			const reqId = typeof message.requestId === "string" ? message.requestId : undefined;
			try {
				const result = await ctx.claudeCode.reloadPluginsLive(message.sessionId as string);
				reply({
					type: "cc_plugins_reloaded_live",
					data: result,
					requestId: reqId,
				});
			} catch (err: unknown) {
				reply({
					type: "cc_plugins_reloaded_live",
					data: null,
					error: err instanceof Error ? err.message : "Unknown error",
					requestId: reqId,
				});
			}
			return true;
		}
		// SDK 0.2.87: Tag a session
		case "cc_tag_session": {
			const reqId = typeof message.requestId === "string" ? message.requestId : undefined;
			try {
				const ok = await ctx.claudeCode.tagSession(
					message.sessionId as string,
					(message.tag as string | null) ?? null,
					message.cwd as string | undefined,
				);
				reply({
					type: "cc_session_tagged",
					data: { ok },
					requestId: reqId,
				});
			} catch (err: unknown) {
				reply({
					type: "cc_session_tagged",
					data: { ok: false },
					error: err instanceof Error ? err.message : "Unknown error",
					requestId: reqId,
				});
			}
			return true;
		}
		default:
			return false;
	}
}
