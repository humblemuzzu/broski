export type ClaudeCodeSupportedModel = {
	value: string;
	displayName: string;
	description: string;
	supportsEffort?: boolean;
	supportedEffortLevels?: ("low" | "medium" | "high" | "max")[];
	supportsAdaptiveThinking?: boolean;
	supportsFastMode?: boolean;
	supportsAutoMode?: boolean; // SDK 0.2.87
};

export type ClaudeCodeAccountInfo = {
	email?: string;
	organization?: string;
	subscriptionType?: string;
	tokenSource?: string;
	apiKeySource?: string;
	/** Not in SDK AccountInfo type but present in raw response; used for env var injection */
	accountUuid?: string;
	organizationUuid?: string;
	/** API provider name (e.g. "anthropic", "bedrock", "vertex") from AccountInfo */
	apiProvider?: string | null;
};

export type ClaudeCodeMcpToolAnnotations = {
	readOnly?: boolean;
	destructive?: boolean;
	openWorld?: boolean;
};

export type ClaudeCodeMcpServerStatus = {
	name: string;
	status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
	serverInfo?: {
		name: string;
		version: string;
	};
	error?: string;
	config?: Record<string, unknown>;
	scope?: string;
	tools?: Array<{
		name: string;
		description?: string;
		annotations?: ClaudeCodeMcpToolAnnotations;
	}>;
};

export type ClaudeCodeModelUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	webSearchRequests: number;
	costUSD: number;
	contextWindow: number;
	maxOutputTokens: number;
};

export type ClaudeCodePermissionDenial = {
	toolName: string;
	toolUseId: string;
	// SDK always sends tool_input (required), but we keep optional for defensive runtime safety.
	toolInput?: Record<string, unknown>;
};

export type ClaudeCodeRateLimitInfo = {
	status?: "allowed" | "allowed_warning" | "rejected";
	resetsAt?: number;
	rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage" | string;
	utilization?: number;
	overageStatus?: "allowed" | "allowed_warning" | "rejected";
	overageResetsAt?: number;
	overageDisabledReason?: string;
	isUsingOverage?: boolean;
	surpassedThreshold?: number;
};

export type ClaudeCodeTranscriptToolCall = {
	toolUseId: string;
	tool: string;
	input?: any;
	status: "running" | "completed" | "failed";
	output?: string;
	metadata?: Record<string, unknown>;
};

export type ClaudeCodeTranscriptDiff = {
	file: string;
	before: string;
	after: string;
	additions: number;
	deletions: number;
	diff?: string;
	partId?: string;
};

export type ClaudeCodeTranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	createdAt: number;
	text: string;
	thinking?: string;
	toolCalls?: ClaudeCodeTranscriptToolCall[];
	diffs?: ClaudeCodeTranscriptDiff[];
};
