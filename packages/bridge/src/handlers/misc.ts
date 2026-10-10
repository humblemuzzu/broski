/**
 * Miscellaneous message handlers.
 *
 * Handles: pong, client_ping, restart_opencode, set_agent, get_agents_status,
 * get_subscription_usage, get_provider_usage
 */

import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import * as pi from "../connectors/pi";
import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import type { AgentStatusInfo, AgentType, ServerMessage } from "../types";

type ReplyFn = (msg: ServerMessage) => void;

const MISC_OPS = [
	"pong",
	"client_ping",
	"restart_opencode",
	"set_agent",
	"get_agents_status",
	"get_subscription_usage",
	"get_provider_usage",
] as const;

export const MODULE_TYPES = MISC_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	const ctx: MiscHandlerContext = {
		contexts: deps.contexts,
		send: deps.send,
		log: deps.log,
		getCurrentAgent: deps.getCurrentAgent,
		setCurrentAgent: deps.setCurrentAgent,
		ensureClaudeWatchDir: deps.ensureClaudeWatchDir,
		claudeCode: deps.claudeCode,
		checkCodexAvailable: deps.checkCodexAvailable,
		getBackendsStatus: deps.getBackendsStatus,
		restartOpenCode: deps.restartOpenCode,
	};
	registerAll(router, MISC_OPS, async (message, c) => {
		await handle(c.ws, message, c.reply, ctx);
	});
}

export type MiscHandlerContext = {
	contexts: Map<
		ServerWebSocket<unknown>,
		{
			lastPongAt: number;
			lastRttMs: number;
			pendingPing?: { id: string; sentAt: number };
			connectionType: "local" | "tailscale" | "unknown";
			connectedAt: number;
			projectPath?: string;
			[key: string]: unknown;
		}
	>;
	send: (ws: ServerWebSocket<unknown>, msg: ServerMessage) => void;
	log: (msg: string) => void;
	// set_agent
	getCurrentAgent: () => AgentType;
	setCurrentAgent: (agent: AgentType) => void;
	ensureClaudeWatchDir: (
		path: string,
		kind: "skills" | "plugins" | "hooks" | "commands" | "mcp",
		cwd?: string,
		recursive?: boolean,
	) => void;
	claudeCode: {
		checkClaudeCodeAvailable: () => Promise<boolean>;
	};
	checkCodexAvailable: () => Promise<boolean>;
	getBackendsStatus: () => Promise<Record<AgentType, AgentStatusInfo>>;
	// restart
	restartOpenCode?: () => Promise<boolean | undefined>;
};

export async function handle(
	ws: ServerWebSocket<unknown>,
	message: Record<string, unknown>,
	reply: ReplyFn,
	ctx: MiscHandlerContext,
): Promise<boolean> {
	const type = message.type as string;
	switch (type) {
		case "pong": {
			const connCtx = ctx.contexts.get(ws);
			if (!connCtx) return true;
			connCtx.lastPongAt = Date.now();
			connCtx.lastRttMs = Math.max(0, connCtx.lastPongAt - (message.sentAt as number));
			// Always clear pendingPing — even a late/mismatched pong proves the
			// client is alive and unblocks the next heartbeat ping cycle.
			connCtx.pendingPing = undefined;
			if (connCtx.connectionType === "unknown") {
				connCtx.connectionType = connCtx.lastRttMs > 30 ? "tailscale" : "local";
			}
			ctx.send(ws, {
				type: "connection_metrics",
				data: {
					rttMs: connCtx.lastRttMs,
					lastPongAt: connCtx.lastPongAt,
					connectionType: connCtx.connectionType,
				},
			} as ServerMessage);
			return true;
		}
		case "client_ping": {
			// Receiving a client_ping proves the client is alive — update
			// lastPongAt so the bridge heartbeat doesn't kill a healthy
			// connection when its own ping/pong cycle has a lost packet.
			const pingCtx = ctx.contexts.get(ws);
			if (pingCtx) {
				pingCtx.lastPongAt = Date.now();
			}
			ctx.send(ws, {
				type: "client_pong",
				id: message.id,
				sentAt: message.sentAt,
				receivedAt: Date.now(),
			} as ServerMessage);
			return true;
		}
		case "restart_opencode": {
			const ok = await ctx.restartOpenCode?.();
			reply({ type: "opencode_restarted", data: ok === true } as ServerMessage);
			return true;
		}
		case "set_agent": {
			const agent = message.agent as AgentType;
			ctx.setCurrentAgent(agent);
			ctx.log(`Agent switched to: ${agent}`);
			if (agent === "claude-code") {
				const connCtx = ctx.contexts.get(ws);
				const cwd = connCtx?.projectPath && connCtx.projectPath !== "global" ? connCtx.projectPath : undefined;
				if (cwd) {
					ctx.ensureClaudeWatchDir(join(cwd, ".claude", "skills"), "skills", cwd);
					ctx.ensureClaudeWatchDir(join(cwd, ".claude", "plugins"), "plugins", cwd);
					ctx.ensureClaudeWatchDir(join(cwd, ".claude", "commands"), "commands", cwd);
					ctx.ensureClaudeWatchDir(join(cwd, ".claude", "hooks"), "hooks", cwd);
					ctx.ensureClaudeWatchDir(join(cwd, ".mcp.json"), "mcp", cwd, false);
				}
				const envKey = !!process.env.ANTHROPIC_API_KEY;
				const available = await ctx.claudeCode.checkClaudeCodeAvailable();
				ctx.log(
					`[Claude Code] Auth: ${available ? "OK" : "MISSING"} (${envKey ? "ANTHROPIC_API_KEY" : "~/.claude/settings.json"})`,
				);
				if (!available) {
					ctx.log(
						`[Claude Code] Set ANTHROPIC_API_KEY or run 'claude login' on this machine before using Claude Code from Broski.`,
					);
				}
			}
			if (agent === "codex") {
				const available = await ctx.checkCodexAvailable();
				ctx.log(`[Codex] ${available ? "OK" : "MISSING"} (requires 'codex' in PATH)`);
			}
			if (agent === "pi") {
				const status = await pi.isPiAvailable();
				ctx.log(
					`[Pi] ${status.available ? "OK" : "MISSING"} (${status.authenticated ? `${status.modelCount} authenticated models` : "no authenticated providers"})`,
				);
			}
			return true;
		}
		case "get_agents_status": {
			const backends = await ctx.getBackendsStatus();
			reply({ type: "agents_status", data: backends } as ServerMessage);
			return true;
		}
		case "get_subscription_usage": {
			const subscriptionTracker = await import("../subscription-tracker");
			const usage = await subscriptionTracker.getSubscriptionUsage();
			reply({ type: "subscription_usage", data: usage } as ServerMessage);
			return true;
		}
		case "get_provider_usage": {
			const subscriptionTracker = await import("../subscription-tracker");
			const usage = await subscriptionTracker.getProviderUsage(message.providerId as "claude" | "openai");
			reply({ type: "provider_usage", data: usage } as ServerMessage);
			return true;
		}
		default:
			return false;
	}
}
