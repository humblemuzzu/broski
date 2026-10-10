import type { SDKCompactBoundaryMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCodeAccountInfo, ClaudeCodeMcpServerStatus, ClaudeCodeSupportedModel } from "../../types";
import { cacheCapabilities, collectCapabilitiesFromQuery, normalizeMcpServerStatuses } from "./capabilities";
import type { QueryContext, QueryEmit } from "./query-context";
import { activeSessions } from "./shared";

type QueryCapabilities = {
	supportedModels?: ClaudeCodeSupportedModel[];
	accountInfo?: ClaudeCodeAccountInfo;
	mcpStatuses?: ClaudeCodeMcpServerStatus[];
};

function cacheInitMcpStatuses(cwd: string, message: SDKSystemMessage): SDKSystemMessage["mcp_servers"] {
	const initMcpServers = Array.isArray(message.mcp_servers) ? message.mcp_servers : [];
	const initMcpStatuses = normalizeMcpServerStatuses(
		initMcpServers.map((server: any) => ({
			name: server?.name,
			status: server?.status,
		})),
	);
	cacheCapabilities(cwd, { mcpStatuses: initMcpStatuses });
	return initMcpServers;
}

async function collectQueryCapabilities(ctx: QueryContext): Promise<QueryCapabilities | undefined> {
	try {
		return await collectCapabilitiesFromQuery(ctx.query, ctx.options.cwd);
	} catch {
		return undefined;
	}
}

function buildSessionInitEvent(
	ctx: QueryContext,
	message: SDKSystemMessage,
	capabilities: QueryCapabilities | undefined,
	initMcpServers: SDKSystemMessage["mcp_servers"],
): Record<string, unknown> {
	return {
		type: "session-init",
		sessionId: ctx.sessionId,
		model: message.model || ctx.sdkOptions.model,
		permissionMode: message.permissionMode || ctx.sdkOptions.permissionMode,
		tools: Array.isArray(message.tools) ? message.tools : [],
		slashCommands: Array.isArray(message.slash_commands) ? message.slash_commands : [],
		skills: Array.isArray(message.skills) ? message.skills : [],
		agents: Array.isArray(message.agents) ? message.agents : [],
		mcpServers: capabilities?.mcpStatuses ?? initMcpServers,
		plugins: Array.isArray(message.plugins) ? message.plugins : [],
		apiKeySource: message.apiKeySource,
		claudeCodeVersion: message.claude_code_version,
		// B15: forward active betas and output style
		...(Array.isArray(message.betas) && message.betas.length > 0 ? { betas: message.betas } : {}),
		...(message.output_style ? { outputStyle: message.output_style } : {}),
		...(() => {
			const aos = (message as Record<string, unknown>).available_output_styles;
			return Array.isArray(aos) && aos.length > 0 ? { availableOutputStyles: aos } : {};
		})(),
		...(message.cwd ? { cwd: message.cwd } : {}),
		supportedModels: capabilities?.supportedModels,
		accountInfo: capabilities?.accountInfo,
		...(typeof message.fast_mode_state === "string" ? { fastModeState: message.fast_mode_state } : {}),
	};
}

/** System init: session created + capabilities snapshot (tools/commands/etc). */
export async function handleSystemInit(ctx: QueryContext, message: SDKSystemMessage, emit: QueryEmit): Promise<void> {
	ctx.sessionId = message.session_id;
	activeSessions.set(ctx.sessionId, {
		controller: ctx.controller,
		cwd: ctx.options.cwd,
		query: ctx.query,
		startedAt: Date.now(),
	});
	emit({
		type: "session-created",
		sessionId: ctx.sessionId,
		agent: "claude-code",
		model: message.model || ctx.sdkOptions.model,
	});

	const initMcpServers = cacheInitMcpStatuses(ctx.options.cwd, message);
	const capabilities = await collectQueryCapabilities(ctx);
	emit(buildSessionInitEvent(ctx, message, capabilities, initMcpServers));
}

export function handleCompactBoundary(message: SDKCompactBoundaryMessage, emit: QueryEmit): void {
	const trigger = message?.compact_metadata?.trigger === "manual" ? "manual" : "auto";
	const preTokens = Number(message?.compact_metadata?.pre_tokens ?? 0);
	emit({
		type: "compact-boundary",
		trigger,
		preTokens: Number.isFinite(preTokens) ? preTokens : 0,
	});
}
