import { randomBytes } from "node:crypto";
import type { ElicitationRequest, ElicitationResult, Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { loadClaudeAgentSdk } from "../../sdk/claude-agent-sdk";
import type {
	ClaudeCodeAccountInfo,
	ClaudeCodeBeta,
	ClaudeCodeEffort,
	ClaudeCodeMcpServerStatus,
	ClaudeCodeOutputFormat,
	ClaudeCodePermissionMode,
	ClaudeCodeSandboxSettings,
	ClaudeCodeStreamMessage,
	ClaudeCodeSubagent,
	ClaudeCodeSupportedModel,
	ClaudeCodeThinkingOption,
	PermissionResponse,
} from "../../types";
import {
	cacheCapabilities,
	collectCapabilitiesFromQuery,
	normalizeMcpServerStatuses,
	normalizeModelUsage,
	normalizePermissionDenials,
	pickContextWindow,
} from "./capabilities";
import {
	activeSessions,
	ccAccountInfoByCwd,
	cwdCacheKey,
	getCurrentConfig,
	normalizeBetas,
	variantToThinkingTokens,
} from "./shared";
import { emitClaudeCodeSupplementalStreamEvents } from "./stream-supplemental-events";

/**
 * Convert an array of ClaudeCodeSubagent to SDK's agents Record format.
 * The SDK expects agents as Record<name, { description, prompt, tools?, model? }>
 */
function convertSubagentsToRecord(subagents: ClaudeCodeSubagent[]): Record<
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

export type ClaudeCodeQueryOptions = {
	cwd: string;
	sessionId?: string;
	model?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	permissionMode?: ClaudeCodePermissionMode;
	maxThinkingTokens?: number | null;
	maxTurns?: number;
	maxBudgetUsd?: number;
	betas?: ClaudeCodeBeta[];
	variant?: string; // Named thinking level (low/medium/high/max) - maps to maxThinkingTokens (DEPRECATED)
	thinking?: ClaudeCodeThinkingOption; // New structured thinking option (SDK 0.2.42+)
	effort?: ClaudeCodeEffort; // Effort level (SDK 0.2.42+)
	agent?: string; // Top-level agent name (SDK 0.2.42+)
	systemPrompt?: string | { type: "preset"; preset: string; append?: string } | null;
	resumeSessionAt?: string;
	outputFormat?: ClaudeCodeOutputFormat;
	sandbox?: ClaudeCodeSandboxSettings;
	enableAgentTeams?: boolean;
	enableFileCheckpointing?: boolean;
	persistSession?: boolean;
	promptSuggestions?: boolean;
	enableClaudeAiMcpServers?: boolean;
	agents?: Record<string, ClaudeCodeSubagent>; // Custom subagent definitions
	activeSubagent?: string; // Name of the subagent to use for this query (prepends prompt hint)
	fallbackModel?: string; // B5: fallback model on primary failure
	additionalDirectories?: string[]; // B6: extra directories agent can access
	agentProgressSummaries?: boolean; // SDK 0.2.74: AI-generated progress summaries for subagents
	continueSession?: boolean; // SDK 0.2.87: Continue most recent conversation in cwd
	forkOnResume?: boolean; // SDK 0.2.87: Fork to new session ID when resuming
};

export async function queryClaudeCode(
	prompt: string,
	options: ClaudeCodeQueryOptions,
	onMessage: (message: ClaudeCodeStreamMessage) => void,
	onComplete: (sessionId: string) => void,
	onError: (error: Error) => void,
	onPermissionRequest?: (request: {
		sessionId: string;
		toolUseId: string;
		tool: string;
		input: Record<string, unknown>;
		decisionReason?: string;
		blockedPath?: string;
		hasSuggestions?: boolean;
		suggestions?: unknown[]; // SDK 0.2.87: PermissionUpdate[] for "Always Allow" persistence
		title?: string; // SDK 0.2.87: Full permission prompt sentence
		displayName?: string; // SDK 0.2.87: Short noun phrase (e.g. "Read file")
		description?: string;
		agentId?: string;
	}) => Promise<
		| PermissionResponse
		| {
				response: PermissionResponse;
				updatedInput?: Record<string, unknown>;
				updatedPermissions?: unknown[]; // SDK 0.2.87: PermissionUpdate[] from Flutter
				decisionClassification?: string; // SDK 0.2.87
		  }
	>,
	onElicitationRequest?: (request: {
		sessionId: string;
		requestId: string;
		mcpServerName: string;
		message: string;
		mode?: "form" | "url";
		url?: string;
		elicitationId?: string;
		requestedSchema?: Record<string, unknown>;
	}) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>,
): Promise<void> {
	let sessionId: string | null = options.sessionId || null;
	const controller = new AbortController();
	let sawStreamEvents = false;
	// Track stream_event tool_use blocks so input_json_delta can update live tool inputs.
	const toolUseIdByStreamIndex = new Map<number, string>();
	const toolNameByToolUseId = new Map<string, string>();
	const toolInputJsonBufferByToolUseId = new Map<string, string>();

	try {
		const config = getCurrentConfig();
		const systemPrompt = options.systemPrompt ?? config.systemPrompt;
		const enableCheckpointing = options.enableFileCheckpointing ?? true; // Default to true for undo support
		const betas = normalizeBetas(options.betas ?? config.betas);
		const maxTurns = typeof options.maxTurns === "number" ? options.maxTurns : config.maxTurns;
		const maxBudgetUsd = typeof options.maxBudgetUsd === "number" ? options.maxBudgetUsd : config.maxBudgetUsd;
		const sandbox = options.sandbox ?? config.sandbox;
		const outputFormat = options.outputFormat ?? config.outputFormat;
		const enableAgentTeams = options.enableAgentTeams ?? config.enableAgentTeams ?? false;

		const thinking = options.thinking ?? config.thinking;
		const effort = options.effort ?? config.effort;
		const persistSession = options.persistSession;
		const promptSuggestions = options.promptSuggestions ?? config.promptSuggestions;
		const enableClaudeAiMcpServers = options.enableClaudeAiMcpServers ?? config.enableClaudeAiMcpServers;

		const sdkOptions: Partial<Options> & { extraArgs?: Record<string, string | null> } = {
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
			...(options.agentProgressSummaries !== undefined
				? { agentProgressSummaries: options.agentProgressSummaries }
				: {}),
		};

		if (Array.isArray(betas) && betas.length > 0) {
			sdkOptions.betas = betas;
		}
		if (typeof maxTurns === "number" && maxTurns > 0) {
			sdkOptions.maxTurns = maxTurns;
		}
		if (typeof maxBudgetUsd === "number" && maxBudgetUsd > 0) {
			sdkOptions.maxBudgetUsd = maxBudgetUsd;
		}
		if (sandbox && typeof sandbox === "object") {
			sdkOptions.sandbox = sandbox;
		}
		if (outputFormat && typeof outputFormat === "object") {
			sdkOptions.outputFormat = outputFormat;
		}
		if (sdkOptions.permissionMode === "bypassPermissions") {
			sdkOptions.allowDangerouslySkipPermissions = true;
		}

		// Build env overrides: merge checkpointing + agent teams flags into process.env.
		// SDK docs require CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1 for checkpoint tracking.
		const envOverrides: Record<string, string> = {};
		if (enableCheckpointing) {
			envOverrides.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = "1";
		}
		if (enableAgentTeams) {
			envOverrides.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
		}
		if (enableClaudeAiMcpServers === false) {
			envOverrides.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
		}

		const cachedAccountInfo = ccAccountInfoByCwd.get(cwdCacheKey(options.cwd));
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

		if (systemPrompt) {
			// Narrow preset type to match SDK's literal 'claude_code' requirement
			if (typeof systemPrompt === "string") {
				sdkOptions.systemPrompt = systemPrompt;
			} else if (systemPrompt.type === "preset" && systemPrompt.preset === "claude_code") {
				sdkOptions.systemPrompt = { type: "preset", preset: "claude_code" as const, append: systemPrompt.append };
			}
		}

		// Custom subagents: Convert from our format to SDK's AgentDefinition format
		// Note: agents must include the Task tool in allowedTools for subagent invocation to work
		const agents =
			options.agents || (config.subagents?.length ? convertSubagentsToRecord(config.subagents) : undefined);
		if (agents && Object.keys(agents).length > 0) {
			// Ensure Task tool stays available when subagents are configured (SDK uses Task for invocation).
			if (Array.isArray(sdkOptions.allowedTools) && !sdkOptions.allowedTools.includes("Task")) {
				sdkOptions.allowedTools = [...sdkOptions.allowedTools, "Task"];
			}
			sdkOptions.agents = agents as Record<string, import("@anthropic-ai/claude-agent-sdk").AgentDefinition>;
		}

		// Custom MCP Tools: Load user-defined custom tools
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

		// Load enabled plugins
		try {
			const pluginsModule = await import("../../plugins");
			const enabledPlugins = await pluginsModule.getEnabledPluginsForSdk(options.cwd);
			if (enabledPlugins.length > 0) {
				sdkOptions.plugins = enabledPlugins;
			}
		} catch (err) {
			// Plugins are optional, log but don't fail
			console.warn("[Claude Code] Failed to load plugins:", err);
		}

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

		if (onPermissionRequest) {
			sdkOptions.canUseTool = async (toolName, input, ctx) => {
				// Compliance: honour abort signal — if session was aborted while
				// waiting for permission, reject immediately.
				if (ctx.signal?.aborted) {
					return { behavior: "deny", message: "Session aborted", toolUseID: ctx.toolUseID };
				}
				const sid = sessionId ?? options.sessionId ?? "";
				const hasSuggestions = Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0;
				const decision = await onPermissionRequest({
					sessionId: sid,
					toolUseId: ctx.toolUseID,
					tool: toolName,
					input,
					decisionReason: ctx.decisionReason,
					blockedPath: ctx.blockedPath,
					hasSuggestions,
					// SDK 0.2.87: Forward full suggestions array for "Always Allow" rule persistence
					...(hasSuggestions ? { suggestions: ctx.suggestions } : {}),
					// SDK 0.2.87: Human-readable fields from the bridge
					...(typeof ctx.title === "string" ? { title: ctx.title } : {}),
					...(typeof ctx.displayName === "string" ? { displayName: ctx.displayName } : {}),
					// Description: prefer SDK-provided, fall back to tool input
					description:
						typeof ctx.description === "string"
							? ctx.description
							: typeof input?.description === "string"
								? input.description
								: undefined,
					agentId: ctx.agentID,
				});

				const rawResponse = typeof decision === "string" ? decision : decision?.response;
				const response: PermissionResponse =
					rawResponse === "once" || rawResponse === "always" || rawResponse === "reject" ? rawResponse : "reject";
				const updatedInput =
					typeof decision === "object" &&
					decision?.updatedInput &&
					typeof decision.updatedInput === "object" &&
					!Array.isArray(decision.updatedInput)
						? decision.updatedInput
						: input;

				if (response === "reject") {
					return {
						behavior: "deny",
						message: "User denied permission",
						interrupt: true,
						toolUseID: ctx.toolUseID,
						decisionClassification: "user_reject" as const,
					};
				}

				// SDK 0.2.87: Use updatedPermissions from Flutter response if provided,
				// otherwise fall back to SDK suggestions (backward compat)
				const suggestionsFromSdk =
					Array.isArray(ctx.suggestions) && ctx.suggestions.length > 0 ? ctx.suggestions : undefined;
				const permissionsFromDecision =
					typeof decision === "object" && Array.isArray(decision?.updatedPermissions)
						? (decision.updatedPermissions as typeof ctx.suggestions)
						: undefined;
				const updatedPermissions = response === "always" ? (permissionsFromDecision ?? suggestionsFromSdk) : undefined;

				return {
					behavior: "allow" as const,
					updatedInput,
					...(updatedPermissions ? { updatedPermissions } : {}),
					toolUseID: ctx.toolUseID,
					decisionClassification: response === "always" ? ("user_permanent" as const) : ("user_temporary" as const),
				};
			};
		}

		sdkOptions.onElicitation = async (
			request: ElicitationRequest,
			ctx: { signal: AbortSignal },
		): Promise<ElicitationResult> => {
			if (ctx.signal?.aborted) {
				return { action: "cancel" };
			}

			if (!onElicitationRequest) {
				return { action: "decline" };
			}

			const sid = sessionId ?? options.sessionId ?? "";
			const requestId = randomBytes(8).toString("hex");

			const response = await onElicitationRequest({
				sessionId: sid,
				requestId,
				mcpServerName: request.serverName,
				message: request.message,
				mode: request.mode,
				url: request.url,
				elicitationId: request.elicitationId,
				requestedSchema: request.requestedSchema,
			});

			const action =
				response.action === "accept" || response.action === "decline" || response.action === "cancel"
					? response.action
					: "cancel";

			if (action !== "accept") {
				return { action };
			}

			const content =
				response.content && typeof response.content === "object" && !Array.isArray(response.content)
					? (response.content as Record<string, string | number | boolean | string[]>)
					: undefined;

			return {
				action: "accept" as const,
				...(content ? { content } : {}),
			};
		};

		// If activeSubagent is specified and no top-level `agent` was set,
		// use the SDK 0.2.42 `agent` option for proper subagent routing.
		// Falls back to prompt hint for agents not in the `agents` option.
		let finalPrompt = prompt;
		if (options.activeSubagent && !sdkOptions.agent) {
			const agentName = options.activeSubagent;
			const configuredAgents = sdkOptions.agents || {};
			if (configuredAgents[agentName]) {
				// SDK 0.2.42: use proper `agent` option
				sdkOptions.agent = agentName;
			} else {
				// Fallback: prompt hint for filesystem-based agents
				finalPrompt = `Use the ${agentName} agent to handle this request.\n\n${prompt}`;
			}
		}

		// Compliance: if no structured `thinking` was set, convert legacy
		// variant/maxThinkingTokens to the proper `thinking` option on sdkOptions
		// BEFORE creating the query. setMaxThinkingTokens() is deprecated.
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

		const { query } = await loadClaudeAgentSdk();
		const q = query({ prompt: finalPrompt, options: sdkOptions });

		for await (const message of q) {
			// Extract parent_tool_use_id from SDK message for subagent context tracking.
			// When non-null, this message originated from inside a subagent's execution.
			const parentToolUseId =
				"parent_tool_use_id" in message ? (message.parent_tool_use_id as string | undefined) : undefined;
			const emit = (msg: Record<string, unknown>) =>
				onMessage((parentToolUseId ? { ...msg, parentToolUseId } : msg) as ClaudeCodeStreamMessage);

			// System init: session created + capabilities snapshot (tools/commands/etc)
			if (message?.type === "system" && message?.subtype === "init") {
				sessionId = message.session_id;
				activeSessions.set(sessionId, {
					controller,
					cwd: options.cwd,
					query: q,
					startedAt: Date.now(),
				});
				emit({
					type: "session-created",
					sessionId,
					agent: "claude-code",
					model: message.model || sdkOptions.model,
				});

				const initMcpServers = Array.isArray(message.mcp_servers) ? message.mcp_servers : [];
				const initMcpStatuses = normalizeMcpServerStatuses(
					initMcpServers.map((server: any) => ({
						name: server?.name,
						status: server?.status,
					})),
				);
				cacheCapabilities(options.cwd, { mcpStatuses: initMcpStatuses });

				let capabilities:
					| {
							supportedModels?: ClaudeCodeSupportedModel[];
							accountInfo?: ClaudeCodeAccountInfo;
							mcpStatuses?: ClaudeCodeMcpServerStatus[];
					  }
					| undefined;
				try {
					capabilities = await collectCapabilitiesFromQuery(q, options.cwd);
				} catch {
					capabilities = undefined;
				}

				emit({
					type: "session-init",
					sessionId,
					model: message.model || sdkOptions.model,
					permissionMode: message.permissionMode || sdkOptions.permissionMode,
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
				});

				// (Legacy thinking fallback was moved before query() call — see below)
			}

			if (message?.type === "system" && message?.subtype === "compact_boundary") {
				const trigger = message?.compact_metadata?.trigger === "manual" ? "manual" : "auto";
				const preTokens = Number(message?.compact_metadata?.pre_tokens ?? 0);
				emit({
					type: "compact-boundary",
					trigger,
					preTokens: Number.isFinite(preTokens) ? preTokens : 0,
				});
			}

			// Stream events: prefer these for real-time deltas (avoids double-emitting full assistant blocks)
			if (message?.type === "stream_event" && message?.event) {
				sawStreamEvents = true;
				const event = message.event;

				if (event.type === "content_block_start") {
					const block = event.content_block;
					const index = event.index;
					if (block?.type === "text" && typeof block?.text === "string" && block.text.length > 0) {
						emit({ type: "assistant-message-delta", content: block.text });
					}
					if (block?.type === "tool_use") {
						const toolName = block.name as string;
						const toolInput = block.input as Record<string, unknown>;
						const toolUseId = block.id as string | undefined;

						if (typeof index === "number" && toolUseId) {
							toolUseIdByStreamIndex.set(index, toolUseId);
						}
						if (toolUseId) {
							toolNameByToolUseId.set(toolUseId, toolName);
							toolInputJsonBufferByToolUseId.delete(toolUseId);
						}

						emit({
							type: "tool-call",
							tool: toolName,
							input: toolInput,
							toolUseId,
							status: "running",
						});

						// Detect subagent invocations via Task tool
						// Per SDK docs, Task tool is used to invoke subagents with subagent_type in input
						if (toolName === "Task") {
							const subagentType = toolInput?.subagent_type as string | undefined;
							if (subagentType) {
								emit({
									type: "subagent-invocation",
									subagentName: subagentType,
									toolUseId,
									prompt: toolInput?.prompt as string | undefined,
									description: toolInput?.description as string | undefined,
								});
							}
						}
					}
				}

				if (event.type === "content_block_delta") {
					const delta = event.delta;
					const deltaType = delta.type as string; // widen for forward-compat (e.g. reasoning_delta)
					if (deltaType === "text_delta" && "text" in delta && typeof delta.text === "string") {
						emit({ type: "assistant-message-delta", content: delta.text });
					} else if (
						(deltaType === "thinking_delta" || deltaType === "reasoning_delta") &&
						"thinking" in delta &&
						typeof delta.thinking === "string"
					) {
						emit({
							type: "thinking-delta",
							content: delta.thinking,
							partId: `thinking_${event.index}`,
						});
					} else if (
						deltaType === "input_json_delta" &&
						"partial_json" in delta &&
						typeof delta.partial_json === "string"
					) {
						const index = event.index;
						const toolUseId = typeof index === "number" ? toolUseIdByStreamIndex.get(index) : undefined;
						if (toolUseId) {
							const nextJson = `${toolInputJsonBufferByToolUseId.get(toolUseId) ?? ""}${delta.partial_json}`;
							toolInputJsonBufferByToolUseId.set(toolUseId, nextJson);

							let parsedInput: Record<string, unknown> | undefined;
							try {
								const parsed = JSON.parse(nextJson);
								if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
									parsedInput = parsed as Record<string, unknown>;
								}
							} catch {
								// partial JSON not complete yet — keep buffering
							}

							const toolName = toolNameByToolUseId.get(toolUseId) ?? "tool";
							emit({
								type: "tool-call",
								tool: toolName,
								input: parsedInput ?? { _partialJson: nextJson },
								toolUseId,
								status: "running",
							});
						}
					}
				}

				if (event.type === "content_block_stop") {
					const index = event.index as number | undefined;
					if (typeof index === "number") {
						const toolUseId = toolUseIdByStreamIndex.get(index);
						if (toolUseId) {
							toolInputJsonBufferByToolUseId.delete(toolUseId);
							toolUseIdByStreamIndex.delete(index);
						}
					}
				}
			}

			// Tool progress signals (long-running tools)
			if (message?.type === "tool_progress") {
				emit({
					type: "tool-call",
					tool: message.tool_name,
					input: {
						elapsedSeconds: message.elapsed_time_seconds,
						// SDK 0.2.87: task_id for correlating progress to background agents
						...(message.task_id ? { taskId: message.task_id } : {}),
					},
					toolUseId: message.tool_use_id,
					status: "running",
				});
			}

			// B9: SDKAssistantMessage.error — surface authentication/billing/rate errors
			if (message?.type === "assistant" && message?.error) {
				emit({
					type: "assistant-error",
					errorType: String(message.error),
				});
			}

			// Full assistant message (fallback if stream events are not emitted)
			if (!sawStreamEvents && message?.type === "assistant") {
				const content = message.message?.content || [];
				for (const block of content) {
					if (block?.type === "text") {
						emit({ type: "assistant-message", content: block.text ?? "" });
					} else if (block?.type === "tool_use") {
						const toolName = block.name as string;
						const toolInput = block.input as Record<string, unknown>;

						emit({
							type: "tool-call",
							tool: toolName,
							input: toolInput,
							toolUseId: block.id,
							status: "running",
						});

						// Detect subagent invocations via Task tool (fallback handler)
						if (toolName === "Task") {
							const subagentType = toolInput?.subagent_type as string | undefined;
							if (subagentType) {
								emit({
									type: "subagent-invocation",
									subagentName: subagentType,
									toolUseId: block.id,
									prompt: toolInput?.prompt as string | undefined,
									description: toolInput?.description as string | undefined,
								});
							}
						}
					}
				}
			}

			// Tool results can surface as "user" messages with tool_result blocks
			// User messages also contain checkpoint UUIDs when file checkpointing is enabled
			if (message?.type === "user") {
				// Emit checkpoint if UUID is present (for file checkpointing/undo support)
				const checkpointUuid = message.uuid as string | undefined;
				if (checkpointUuid && sessionId) {
					emit({
						type: "checkpoint-created",
						sessionId,
						checkpointUuid,
						timestamp: Date.now(),
					});
				}

				const content = message.message?.content || [];
				for (const block of content) {
					if (typeof block === "string") continue;
					if (block?.type === "tool_result") {
						emit({
							type: "tool-result",
							toolUseId: block.tool_use_id,
							result: block.content,
							toolUseResult: (message as SDKUserMessage).tool_use_result,
						});
					}
				}
			}

			// Result / token usage + cost (end of conversation - cumulative totals)
			if (message?.type === "result") {
				if ("result" in message && typeof message.result === "string" && message.result.trim().length > 0) {
					emit({ type: "assistant-message", content: message.result });
				}
				if (message.usage) {
					const modelUsage = normalizeModelUsage(message.modelUsage);
					const contextWindow = pickContextWindow(modelUsage, sdkOptions.model);

					// Extract last message-type iteration for accurate context window usage.
					// usage.iterations has per-API-call breakdowns. The last 'message' iteration
					// reflects the actual current context window occupancy, NOT cumulative totals.
					// See: https://docs.anthropic.com/en/docs/about-claude/models (iterations field)
					let lastIterContextTokens: number | undefined;
					const iterations = message.usage.iterations;
					if (Array.isArray(iterations) && iterations.length > 0) {
						// Walk backwards to find the last message-type iteration (skip compaction iterations)
						for (let i = iterations.length - 1; i >= 0; i--) {
							const iter = iterations[i];
							if (iter && iter.type === "message") {
								lastIterContextTokens =
									(iter.input_tokens ?? 0) +
									(iter.cache_read_input_tokens ?? 0) +
									(iter.cache_creation_input_tokens ?? 0);
								break;
							}
						}
					}

					emit({
						type: "token-usage",
						usage: {
							inputTokens: message.usage.input_tokens,
							outputTokens: message.usage.output_tokens,
							cacheReadTokens: message.usage.cache_read_input_tokens,
							cacheCreationTokens: message.usage.cache_creation_input_tokens,
							...(typeof contextWindow === "number" ? { contextWindow } : {}),
							// Per-turn context tokens from last iteration (actual window occupancy)
							...(typeof lastIterContextTokens === "number" ? { lastIterContextTokens } : {}),
							// SDK newer usage fields
							...(message.usage.cache_creation != null
								? {
										cacheCreation: {
											ephemeral1hInputTokens: message.usage.cache_creation.ephemeral_1h_input_tokens,
											ephemeral5mInputTokens: message.usage.cache_creation.ephemeral_5m_input_tokens,
										},
									}
								: {}),
							...(message.usage.inference_geo != null ? { inferenceGeo: message.usage.inference_geo } : {}),
							...(message.usage.server_tool_use != null
								? {
										serverToolUse: {
											webFetchRequests: message.usage.server_tool_use.web_fetch_requests,
											webSearchRequests: message.usage.server_tool_use.web_search_requests,
										},
									}
								: {}),
							...(message.usage.service_tier != null ? { serviceTier: message.usage.service_tier } : {}),
						},
						// CC SDK: total_cost_usd is on the result message itself, NOT inside usage
						// SDKResultSuccess/SDKResultError both have top-level total_cost_usd
						totalCostUsd: message.total_cost_usd,
						...(modelUsage ? { modelUsage } : {}),
					});
				}

				const errors =
					"errors" in message && Array.isArray(message.errors)
						? message.errors.filter((err: unknown): err is string => typeof err === "string")
						: [];
				const permissionDenials = normalizePermissionDenials(message.permission_denials);

				// B10: emit result-complete with stop_reason + subtype/error metadata
				emit({
					type: "result-complete",
					stopReason: message.stop_reason ?? null,
					numTurns: typeof message.num_turns === "number" ? message.num_turns : undefined,
					durationMs: typeof message.duration_ms === "number" ? message.duration_ms : undefined,
					durationApiMs: typeof message.duration_api_ms === "number" ? message.duration_api_ms : undefined,
					subtype: typeof message.subtype === "string" ? message.subtype : undefined,
					isError: typeof message.is_error === "boolean" ? message.is_error : undefined,
					...(errors.length > 0 ? { errors } : {}),
					...(permissionDenials ? { permissionDenials } : {}),
					...(typeof message.fast_mode_state === "string" ? { fastModeState: message.fast_mode_state } : {}),
					// SDK 0.2.92: terminal reason + deferred tool use
					...(typeof message.terminal_reason === "string" ? { terminalReason: message.terminal_reason } : {}),
					...("deferred_tool_use" in message && message.deferred_tool_use
						? { deferredToolUse: message.deferred_tool_use }
						: {}),
				});

				if ("structured_output" in message && message.structured_output !== undefined) {
					emit({
						type: "structured-output",
						data: message.structured_output,
					});
				}
			}

			const supplementalResult = emitClaudeCodeSupplementalStreamEvents(message, emit, onError);
			if (supplementalResult === "fatal") return;
		}

		if (sessionId) {
			activeSessions.delete(sessionId);
		}
		onComplete(sessionId || "");
	} catch (error) {
		if (sessionId) {
			activeSessions.delete(sessionId);
		}
		onError(error as Error);
	}
}
