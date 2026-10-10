import type { Options, SDKMessage, Query as SDKQuery } from "@anthropic-ai/claude-agent-sdk";
import type {
	ClaudeCodeBeta,
	ClaudeCodeEffort,
	ClaudeCodeOutputFormat,
	ClaudeCodePermissionMode,
	ClaudeCodeSandboxSettings,
	ClaudeCodeStreamMessage,
	ClaudeCodeSubagent,
	ClaudeCodeThinkingOption,
	PermissionResponse,
} from "../../types";

export type SdkOptions = Partial<Options> & { extraArgs?: Record<string, string | null> };

export type QueryEmit = (message: Record<string, unknown>) => void;

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

export type PermissionRequestHandler = (request: {
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
>;

export type ElicitationRequestHandler = (request: {
	sessionId: string;
	requestId: string;
	mcpServerName: string;
	message: string;
	mode?: "form" | "url";
	url?: string;
	elicitationId?: string;
	requestedSchema?: Record<string, unknown>;
}) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>;

export type QueryContext = {
	options: ClaudeCodeQueryOptions;
	sdkOptions: SdkOptions;
	controller: AbortController;
	sessionId: string | null;
	sawStreamEvents: boolean;
	toolUseIdByStreamIndex: Map<number, string>;
	toolNameByToolUseId: Map<string, string>;
	toolInputJsonBufferByToolUseId: Map<string, string>;
	query?: SDKQuery;
	onMessage: (message: ClaudeCodeStreamMessage) => void;
	onError: (error: Error) => void;
};

/**
 * Build the per-message emit closure. `parent_tool_use_id` marks messages that
 * originated inside a subagent's execution, so the app can attribute them.
 */
export function makeMessageEmitter(
	onMessage: (message: ClaudeCodeStreamMessage) => void,
	message: SDKMessage,
): QueryEmit {
	const parentToolUseId =
		"parent_tool_use_id" in message ? (message.parent_tool_use_id as string | undefined) : undefined;
	return (msg) => onMessage((parentToolUseId ? { ...msg, parentToolUseId } : msg) as ClaudeCodeStreamMessage);
}

/**
 * Detect subagent invocations via the Task tool. Per SDK docs, Task is used to
 * invoke subagents with `subagent_type` in its input.
 */
export function emitSubagentInvocation(
	emit: QueryEmit,
	toolName: string,
	toolInput: Record<string, unknown>,
	toolUseId?: string,
): void {
	if (toolName !== "Task") return;
	const subagentType = toolInput?.subagent_type as string | undefined;
	if (!subagentType) return;
	emit({
		type: "subagent-invocation",
		subagentName: subagentType,
		toolUseId,
		prompt: toolInput?.prompt as string | undefined,
		description: toolInput?.description as string | undefined,
	});
}
