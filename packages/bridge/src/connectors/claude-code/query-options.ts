import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type {
	ClaudeCodeBeta,
	ClaudeCodeConfig,
	ClaudeCodeOutputFormat,
	ClaudeCodeSandboxSettings,
	ClaudeCodeSubagent,
} from "../../types";
import type {
	ClaudeCodeQueryOptions,
	ElicitationRequestHandler,
	PermissionRequestHandler,
	QueryContext,
	SdkOptions,
} from "./query-context";
import { buildCanUseTool, buildOnElicitation } from "./query-permission";
import { ccAccountInfoByCwd, cwdCacheKey, getCurrentConfig, normalizeBetas, variantToThinkingTokens } from "./shared";

/**
 * Convert an array of ClaudeCodeSubagent to SDK's agents Record format.
 * The SDK expects agents as Record<name, { description, prompt, tools?, model? }>
 */
export function convertSubagentsToRecord(subagents: ClaudeCodeSubagent[]): Record<
	string,
	{
		description: string;
		prompt: string;
		tools?: string[];
		model?: string;
		permissionMode?: string;
		disallowedTools?: string[];
		skills?: string[];
		maxTurns?: number;
		mcpServers?: Array<string | Record<string, unknown>>;
		background?: boolean;
		isolation?: "worktree";
	}
> {
	const record: Record<
		string,
		{
			description: string;
			prompt: string;
			tools?: string[];
			model?: string;
			permissionMode?: string;
			disallowedTools?: string[];
			skills?: string[];
			maxTurns?: number;
			mcpServers?: Array<string | Record<string, unknown>>;
			background?: boolean;
			isolation?: "worktree";
		}
	> = {};
	for (const agent of subagents) {
		record[agent.name] = {
			description: agent.description,
			prompt: agent.prompt,
			...(agent.tools?.length && { tools: agent.tools }),
			...(agent.model && agent.model !== "inherit" && { model: agent.model }),
			...(agent.permissionMode && { permissionMode: agent.permissionMode }),
			...(agent.disallowedTools?.length && { disallowedTools: agent.disallowedTools }),
			...(agent.skills?.length && { skills: agent.skills }),
			...(typeof agent.maxTurns === "number" && agent.maxTurns > 0 && { maxTurns: agent.maxTurns }),
			...(agent.mcpServers?.length && { mcpServers: agent.mcpServers }),
			...(agent.background === true ? { background: true } : {}),
			...(agent.isolation === "worktree" ? { isolation: "worktree" as const } : {}),
		};
	}
	return record;
}

function buildBaseSdkOptions(
	options: ClaudeCodeQueryOptions,
	config: ClaudeCodeConfig,
	controller: AbortController,
	enableCheckpointing: boolean,
): SdkOptions {
	const thinking = options.thinking ?? config.thinking;
	const effort = options.effort ?? config.effort;
	const persistSession = options.persistSession;
	const promptSuggestions = options.promptSuggestions ?? config.promptSuggestions;

	return {
		cwd: options.cwd,
		model: options.model || config.model || "sonnet",
		allowedTools: options.allowedTools || config.allowedTools,
		disallowedTools: options.disallowedTools || config.disallowedTools,
		permissionMode: options.permissionMode || config.permissionMode,
		// Required for real-time text deltas (SDK docs: default is false).
		includePartialMessages: true,
		abortController: controller,
		settingSources: ["project", "local", "user"],
		// File checkpointing: enable tracking of file changes for undo/rewind support
		...(enableCheckpointing && {
			enableFileCheckpointing: true,
			extraArgs: { "replay-user-messages": null }, // Required to get user message UUIDs
		}),
		// SDK 0.2.42: structured thinking option (replaces maxThinkingTokens)
		...(thinking ? { thinking } : {}),
		// SDK 0.2.42: effort level
		...(effort ? { effort } : {}),
		// SDK 0.2.42: top-level agent selection
		...(options.agent ? { agent: options.agent } : {}),
		// SDK 0.2.42: session persistence control
		...(typeof persistSession === "boolean" ? { persistSession } : {}),
		// SDK 0.2.52: prompt suggestions
		...(typeof promptSuggestions === "boolean" ? { promptSuggestions } : {}),
		// B5: fallback model
		...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
		// B6: additional directories
		...(options.additionalDirectories?.length ? { additionalDirectories: options.additionalDirectories } : {}),
		// SDK 0.2.74: AI-generated progress summaries for subagents
		...(options.agentProgressSummaries !== undefined ? { agentProgressSummaries: options.agentProgressSummaries } : {}),
	};
}

type QueryLimits = {
	betas?: ClaudeCodeBeta[];
	maxTurns?: number;
	maxBudgetUsd?: number;
	sandbox?: ClaudeCodeSandboxSettings;
	outputFormat?: ClaudeCodeOutputFormat;
};

function applyLimitsAndSandbox(sdkOptions: SdkOptions, limits: QueryLimits): void {
	if (Array.isArray(limits.betas) && limits.betas.length > 0) {
		sdkOptions.betas = limits.betas;
	}
	if (typeof limits.maxTurns === "number" && limits.maxTurns > 0) {
		sdkOptions.maxTurns = limits.maxTurns;
	}
	if (typeof limits.maxBudgetUsd === "number" && limits.maxBudgetUsd > 0) {
		sdkOptions.maxBudgetUsd = limits.maxBudgetUsd;
	}
	if (limits.sandbox && typeof limits.sandbox === "object") {
		sdkOptions.sandbox = limits.sandbox;
	}
	if (limits.outputFormat && typeof limits.outputFormat === "object") {
		sdkOptions.outputFormat = limits.outputFormat;
	}
	if (sdkOptions.permissionMode === "bypassPermissions") {
		sdkOptions.allowDangerouslySkipPermissions = true;
	}
}

type EnvFlags = { enableCheckpointing: boolean; enableAgentTeams: boolean; enableClaudeAiMcpServers?: boolean };

// Build env overrides: merge checkpointing + agent teams flags into process.env.
// SDK docs require CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1 for checkpoint tracking.
function applyEnvOverrides(sdkOptions: SdkOptions, cwd: string, flags: EnvFlags): void {
	const envOverrides: Record<string, string> = {};
	if (flags.enableCheckpointing) {
		envOverrides.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "1";
	}
	if (flags.enableAgentTeams) {
		envOverrides.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
	}
	if (flags.enableClaudeAiMcpServers === false) {
		envOverrides.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
	}

	const cachedAccountInfo = ccAccountInfoByCwd.get(cwdCacheKey(cwd));
	if (typeof cachedAccountInfo?.email === "string" && cachedAccountInfo.email.length > 0) {
		envOverrides.CLAUDE_CODE_USER_EMAIL = cachedAccountInfo.email;
	}
	if (typeof cachedAccountInfo?.accountUuid === "string" && cachedAccountInfo.accountUuid.length > 0) {
		envOverrides.CLAUDE_CODE_ACCOUNT_UUID = cachedAccountInfo.accountUuid;
	}
	const organizationUuid =
		typeof cachedAccountInfo?.organizationUuid === "string" && cachedAccountInfo.organizationUuid.length > 0
			? cachedAccountInfo.organizationUuid
			: typeof cachedAccountInfo?.organization === "string" && cachedAccountInfo.organization.length > 0
				? cachedAccountInfo.organization
				: undefined;
	if (organizationUuid) {
		envOverrides.CLAUDE_CODE_ORGANIZATION_UUID = organizationUuid;
	}

	if (Object.keys(envOverrides).length > 0) {
		sdkOptions.env = {
			...(process.env as Record<string, string | undefined>),
			...envOverrides,
		};
	}
}

function applySystemPrompt(
	sdkOptions: SdkOptions,
	systemPrompt: ClaudeCodeQueryOptions["systemPrompt"] | ClaudeCodeConfig["systemPrompt"],
): void {
	if (!systemPrompt) return;
	// Narrow preset type to match SDK's literal 'claude_code' requirement
	if (typeof systemPrompt === "string") {
		sdkOptions.systemPrompt = systemPrompt;
	} else if (systemPrompt.type === "preset" && systemPrompt.preset === "claude_code") {
		sdkOptions.systemPrompt = { type: "preset", preset: "claude_code" as const, append: systemPrompt.append };
	}
}

// Custom subagents: Convert from our format to SDK's AgentDefinition format.
// Note: agents must include the Task tool in allowedTools for subagent invocation to work.
function applyAgents(sdkOptions: SdkOptions, options: ClaudeCodeQueryOptions, config: ClaudeCodeConfig): void {
	const agents = options.agents || (config.subagents?.length ? convertSubagentsToRecord(config.subagents) : undefined);
	if (!agents || Object.keys(agents).length === 0) return;

	// Ensure Task tool stays available when subagents are configured (SDK uses Task for invocation).
	if (Array.isArray(sdkOptions.allowedTools) && !sdkOptions.allowedTools.includes("Task")) {
		sdkOptions.allowedTools = [...sdkOptions.allowedTools, "Task"];
	}
	sdkOptions.agents = agents as Record<string, AgentDefinition>;
}

// Custom MCP Tools: Load user-defined custom tools
async function loadCustomTools(sdkOptions: SdkOptions): Promise<void> {
	try {
		const customToolsModule = await import("../../custom-tools");
		const customToolsServer = await customToolsModule.createCustomToolsServer();
		if (customToolsServer) {
			sdkOptions.mcpServers = {
				...sdkOptions.mcpServers,
				"broski-custom-tools": customToolsServer,
			};
		}
	} catch (err) {
		// Custom tools are optional, log but don't fail
		console.warn("[Claude Code] Failed to load custom tools:", err);
	}
}

// Load enabled plugins
async function loadPlugins(sdkOptions: SdkOptions, cwd: string): Promise<void> {
	try {
		const pluginsModule = await import("../../plugins");
		const enabledPlugins = await pluginsModule.getEnabledPluginsForSdk(cwd);
		if (enabledPlugins.length > 0) {
			sdkOptions.plugins = enabledPlugins;
		}
	} catch (err) {
		// Plugins are optional, log but don't fail
		console.warn("[Claude Code] Failed to load plugins:", err);
	}
}

function applyResumeOptions(sdkOptions: SdkOptions, options: ClaudeCodeQueryOptions): void {
	if (options.sessionId) {
		sdkOptions.resume = options.sessionId;
		if (options.resumeSessionAt) {
			sdkOptions.resumeSessionAt = options.resumeSessionAt;
		}
		// SDK 0.2.87: Fork on resume — create a branch instead of modifying original
		if (options.forkOnResume) {
			sdkOptions.forkSession = true;
		}
	} else if (options.continueSession) {
		// SDK 0.2.87: Continue most recent conversation in cwd (mutually exclusive with resume)
		sdkOptions.continue = true;
	}
}

// If activeSubagent is specified and no top-level `agent` was set, use the SDK
// 0.2.42 `agent` option for proper subagent routing. Falls back to a prompt hint
// for agents not in the `agents` option.
function resolveActiveSubagentPrompt(sdkOptions: SdkOptions, options: ClaudeCodeQueryOptions, prompt: string): string {
	if (!options.activeSubagent || sdkOptions.agent) return prompt;

	const agentName = options.activeSubagent;
	const configuredAgents = sdkOptions.agents || {};
	if (configuredAgents[agentName]) {
		sdkOptions.agent = agentName;
		return prompt;
	}
	return `Use the ${agentName} agent to handle this request.\n\n${prompt}`;
}

// Compliance: if no structured `thinking` was set, convert legacy
// variant/maxThinkingTokens to the proper `thinking` option on sdkOptions
// BEFORE creating the query. setMaxThinkingTokens() is deprecated.
function applyThinkingFallback(sdkOptions: SdkOptions, options: ClaudeCodeQueryOptions): void {
	if (!sdkOptions.thinking) {
		let thinkingTokens = options.maxThinkingTokens;
		if (thinkingTokens === undefined && options.variant) {
			thinkingTokens = variantToThinkingTokens(options.variant);
		}
		if (thinkingTokens !== undefined && thinkingTokens !== null) {
			if (thinkingTokens === 0) {
				sdkOptions.thinking = { type: "disabled" };
			} else {
				sdkOptions.thinking = { type: "enabled", budgetTokens: thinkingTokens };
			}
		}
	}
}

export async function buildQueryOptions(
	ctx: QueryContext,
	prompt: string,
	onPermissionRequest?: PermissionRequestHandler,
	onElicitationRequest?: ElicitationRequestHandler,
): Promise<string> {
	const options = ctx.options;
	const config = getCurrentConfig();
	const systemPrompt = options.systemPrompt ?? config.systemPrompt;
	const enableCheckpointing = options.enableFileCheckpointing ?? true; // Default to true for undo support
	const enableAgentTeams = options.enableAgentTeams ?? config.enableAgentTeams ?? false;
	const enableClaudeAiMcpServers = options.enableClaudeAiMcpServers ?? config.enableClaudeAiMcpServers;

	const sdkOptions = buildBaseSdkOptions(options, config, ctx.controller, enableCheckpointing);
	ctx.sdkOptions = sdkOptions;

	applyLimitsAndSandbox(sdkOptions, {
		betas: normalizeBetas(options.betas ?? config.betas),
		maxTurns: typeof options.maxTurns === "number" ? options.maxTurns : config.maxTurns,
		maxBudgetUsd: typeof options.maxBudgetUsd === "number" ? options.maxBudgetUsd : config.maxBudgetUsd,
		sandbox: options.sandbox ?? config.sandbox,
		outputFormat: options.outputFormat ?? config.outputFormat,
	});

	applyEnvOverrides(sdkOptions, options.cwd, { enableCheckpointing, enableAgentTeams, enableClaudeAiMcpServers });
	applySystemPrompt(sdkOptions, systemPrompt);
	applyAgents(sdkOptions, options, config);
	await loadCustomTools(sdkOptions);
	await loadPlugins(sdkOptions, options.cwd);
	applyResumeOptions(sdkOptions, options);

	if (onPermissionRequest) {
		sdkOptions.canUseTool = buildCanUseTool(ctx, onPermissionRequest);
	}
	sdkOptions.onElicitation = buildOnElicitation(ctx, onElicitationRequest);

	const finalPrompt = resolveActiveSubagentPrompt(sdkOptions, options, prompt);
	applyThinkingFallback(sdkOptions, options);
	return finalPrompt;
}
