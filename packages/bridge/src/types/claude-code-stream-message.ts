import type { ClaudeCodePermissionMode } from "./claude-code";
import type {
	ClaudeCodeAccountInfo,
	ClaudeCodeModelUsage,
	ClaudeCodePermissionDenial,
	ClaudeCodeRateLimitInfo,
	ClaudeCodeSupportedModel,
} from "./claude-code-stream";

// Claude Code Message (for streaming)
export type ClaudeCodeStreamMessage =
	| {
			type: "session-created";
			sessionId: string;
			agent: "claude-code";
			model?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "session-init";
			sessionId: string;
			model: string;
			permissionMode: ClaudeCodePermissionMode;
			tools: string[];
			slashCommands: string[];
			skills: string[];
			agents: string[];
			mcpServers: Array<{ name: string; status: string }>;
			plugins: Array<{ name: string; path: string }>;
			apiKeySource?: string;
			claudeCodeVersion?: string;
			betas?: string[];
			outputStyle?: string;
			availableOutputStyles?: string[];
			cwd?: string;
			supportedModels?: ClaudeCodeSupportedModel[];
			accountInfo?: ClaudeCodeAccountInfo;
			fastModeState?: "off" | "cooldown" | "on";
			parentToolUseId?: string;
	  }
	| {
			type: "compact-boundary";
			trigger: "manual" | "auto";
			preTokens: number;
			parentToolUseId?: string;
	  }
	| {
			type: "permission-request";
			sessionId: string;
			toolUseId: string;
			tool: string;
			input: Record<string, unknown>;
			decisionReason?: string;
			blockedPath?: string;
			hasSuggestions?: boolean;
			/** SDK 0.2.87: Permission suggestions for "Always Allow" rule persistence */
			suggestions?: Array<{
				type: "addRules" | "replaceRules" | "removeRules" | "setMode" | "addDirectories" | "removeDirectories";
				rules?: Array<{ toolName: string; ruleContent?: string }>;
				behavior?: "allow" | "deny" | "ask";
				destination?: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg";
				mode?: string;
				directories?: string[];
			}>;
			/** SDK 0.2.87: Full permission prompt sentence from the bridge */
			title?: string;
			/** SDK 0.2.87: Short noun phrase for the tool action (e.g. "Read file") */
			displayName?: string;
			description?: string;
			agentId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "checkpoint-created";
			sessionId: string;
			checkpointUuid: string;
			timestamp: number;
			parentToolUseId?: string;
	  }
	| {
			type: "assistant-message";
			content: string;
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "assistant-message-delta";
			content: string;
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "thinking-delta";
			content: string;
			partId?: string;
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "tool-call";
			tool: string;
			input: any;
			toolUseId?: string;
			status: "running" | "completed" | "failed";
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "tool-result";
			toolUseId?: string;
			result: any;
			toolUseResult?: any;
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "subagent-invocation";
			subagentName: string;
			toolUseId?: string;
			prompt?: string;
			description?: string;
			messageId?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "token-usage";
			usage: {
				inputTokens?: number;
				outputTokens?: number;
				cacheReadTokens?: number;
				cacheCreationTokens?: number;
				contextWindow?: number;
				/** Per-turn context tokens from last message iteration (actual window occupancy) */
				lastIterContextTokens?: number;
				/** SDK: cache_creation breakdown by TTL */
				cacheCreation?: { ephemeral1hInputTokens?: number; ephemeral5mInputTokens?: number } | null;
				/** SDK: geographic region used for inference */
				inferenceGeo?: string | null;
				/** SDK: server-side tool usage counters */
				serverToolUse?: { webFetchRequests?: number; webSearchRequests?: number } | null;
				/** SDK: service tier used for this request */
				serviceTier?: "standard" | "priority" | "batch" | null;
			};
			totalCostUsd?: number;
			modelUsage?: Record<string, ClaudeCodeModelUsage>;
			messageId?: string;
			parentToolUseId?: string;
	  }
	// B9: assistant-level error classification (authentication_failed, billing_error, rate_limit, etc.)
	| {
			type: "assistant-error";
			errorType: string;
			messageId?: string;
			parentToolUseId?: string;
	  }
	// B10: stop reason + result subtype/details from result message
	| {
			type: "result-complete";
			stopReason?: string | null;
			numTurns?: number;
			durationMs?: number;
			durationApiMs?: number;
			subtype?:
				| "success"
				| "error_during_execution"
				| "error_max_turns"
				| "error_max_budget_usd"
				| "error_max_structured_output_retries"
				| string;
			isError?: boolean;
			errors?: string[];
			permissionDenials?: ClaudeCodePermissionDenial[];
			fastModeState?: "off" | "cooldown" | "on";
			parentToolUseId?: string;
	  }
	// Structured output from SDK result when outputFormat is enabled.
	| { type: "structured-output"; data: unknown; parentToolUseId?: string }
	| {
			type: "local-command-output";
			content: string;
			parentToolUseId?: string;
	  }
	| {
			type: "elicitation-request";
			sessionId?: string;
			requestId: string;
			mcpServerName: string;
			message: string;
			mode?: "form" | "url";
			url?: string;
			elicitationId?: string;
			requestedSchema?: Record<string, unknown>;
			parentToolUseId?: string;
	  }
	| {
			type: "elicitation-complete";
			mcpServerName: string;
			elicitationId: string;
			parentToolUseId?: string;
	  }
	| { type: "error"; message: string; code?: string; parentToolUseId?: string }
	| {
			type: "task-started";
			taskId: string;
			toolUseId?: string;
			description: string;
			taskType?: string;
			/** SDK 0.2.87: meta.name from workflow script (e.g. 'spec') */
			workflowName?: string;
			/** SDK 0.2.87: task prompt text */
			prompt?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "task-progress";
			taskId: string;
			toolUseId?: string;
			description: string;
			usage?: {
				totalTokens: number;
				toolUses: number;
				durationMs: number;
			};
			lastToolName?: string;
			summary?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "task-notification";
			taskId: string;
			toolUseId?: string;
			status: "completed" | "failed" | "stopped";
			summary: string;
			outputFile?: string;
			usage?: {
				totalTokens: number;
				toolUses: number;
				durationMs: number;
			};
			parentToolUseId?: string;
	  }
	| {
			type: "tool-use-summary";
			summary: string;
			precedingToolUseIds: string[];
			parentToolUseId?: string;
	  }
	| {
			type: "files-persisted";
			files: Array<{ filename: string; fileId: string }>;
			failed: Array<{ filename: string; error: string }>;
			parentToolUseId?: string;
	  }
	| {
			type: "status-update";
			status: "compacting" | null;
			permissionMode?: string;
			parentToolUseId?: string;
	  }
	| {
			type: "hook-started";
			hookId: string;
			hookName: string;
			hookEvent: string;
			parentToolUseId?: string;
	  }
	| {
			type: "hook-progress";
			hookId: string;
			hookName: string;
			hookEvent: string;
			output: string;
			parentToolUseId?: string;
	  }
	| {
			type: "hook-response";
			hookId: string;
			hookName: string;
			hookEvent: string;
			output: string;
			outcome: "success" | "error" | "cancelled";
			exitCode?: number;
			parentToolUseId?: string;
	  }
	| {
			type: "rate-limit-info";
			data: ClaudeCodeRateLimitInfo;
			parentToolUseId?: string;
	  }
	| {
			type: "prompt-suggestion";
			suggestion: string;
			parentToolUseId?: string;
	  }
	| {
			type: "auth-status";
			isAuthenticating: boolean;
			output: string[];
			error?: string;
			parentToolUseId?: string;
	  }
	// SDK 0.2.87: Authoritative session state signal (idle after bg-agent completes)
	| {
			type: "session-state-changed";
			sessionState: "idle" | "running" | "requires_action" | string;
			parentToolUseId?: string;
	  }
	// SDK 0.2.87: API retry info when request fails with retryable error
	| {
			type: "api-retry";
			attempt: number;
			maxRetries: number;
			retryDelayMs: number;
			errorStatus?: number | null;
			error?: string;
			parentToolUseId?: string;
	  };
