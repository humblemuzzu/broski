// ============================================================================
// CODEX (OpenAI Codex app-server) TYPES
// ============================================================================

export type CodexPrompt = {
	name: string;
	description?: string;
	argumentHint?: string;
	content: string;
	path: string;
	source: "project" | "user";
};

export type CodexThread = {
	id: string;
	forkedFromId?: string | null; // SDK mid-2026: source thread when forked
	preview: string;
	modelProvider?: string;
	createdAt: number; // Unix timestamp seconds
	updatedAt: number; // Unix timestamp seconds (SDK v0.87.0+)
	cwd: string;
	cliVersion?: string;
	source?: string;
	gitInfo?: { branch?: string } | null;
	status?: { type: string; activeFlags?: string[] };
	agentNickname?: string | null;
	agentRole?: string | null;
	summary?: { additions: number; deletions: number; files: number };
};

export type CodexTranscriptToolCall = {
	itemId: string;
	type: "commandExecution" | "fileChange" | "mcpToolCall" | "webSearch" | "imageView" | "review";
	name: string;
	status: "running" | "completed" | "failed" | "declined";
	input?: any;
	output?: string;
	metadata?: Record<string, unknown>;
};

export type CodexTranscriptDiff = {
	file: string;
	diff: string;
	additions: number;
	deletions: number;
	itemId?: string;
};

export type CodexTranscriptMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	createdAt: number;
	text: string;
	thinking?: string;
	toolCalls?: CodexTranscriptToolCall[];
	diffs?: CodexTranscriptDiff[];
};

export type CodexStreamMessage =
	| { type: "notification"; method: string; params: any }
	| { type: "request"; requestId: string; method: string; params: any }
	| {
			type: "error";
			message: string;
			code?: string;
			details?: any;
			modelCapModel?: string;
			modelCapRetrySeconds?: number;
	  }
	| { type: "info"; message: string };

export type CodexWebSearchMode = "disabled" | "cached" | "live";

// ============================================================================
// CODEX NEW SDK TYPES (mid-2026)
// ============================================================================

export type CodexAppInfo = {
	id: string;
	name: string;
	description: string | null;
	logoUrl: string | null;
	logoUrlDark: string | null;
	distributionChannel: string | null;
	branding?: Record<string, unknown> | null;
	appMetadata?: Record<string, unknown> | null;
	labels?: Record<string, string> | null;
	installUrl: string | null;
	isAccessible: boolean;
	isEnabled: boolean;
};

export type CodexPersonality = "none" | "friendly" | "pragmatic";

export type CodexModeKind = "plan" | "default";

// ============================================================================
// CODEX PLUGIN TYPES (SDK mid-2026)
// ============================================================================

export type CodexPluginSource = {
	type: string;
	[key: string]: unknown;
};

export type CodexPluginInterface = {
	type: string;
	[key: string]: unknown;
};

export type CodexPluginSummary = {
	id: string;
	name: string;
	source: CodexPluginSource;
	installed: boolean;
	enabled: boolean;
	interface?: CodexPluginInterface;
};

export type CodexPluginMarketplace = {
	name: string;
	path: string;
	plugins: CodexPluginSummary[];
};

// ============================================================================
// CODEX HOOK TYPES (SDK mid-2026)
// ============================================================================

export type CodexHookRunStatus = "running" | "completed" | "failed" | "blocked" | "stopped";

export type CodexHookEventName = "sessionStart" | "stop";

export type CodexHookRunEntry = {
	type: string;
	text?: string;
	timestamp?: number;
};

export type CodexHookRunSummary = {
	id: string;
	eventName: CodexHookEventName;
	handlerType: string;
	executionMode: string;
	scope: string;
	sourcePath: string;
	displayOrder: number;
	status: CodexHookRunStatus;
	statusMessage?: string;
	startedAt: number;
	completedAt?: number;
	durationMs?: number;
	entries: CodexHookRunEntry[];
};

// ============================================================================
// CODEX SERVICE TIER + MISC TYPES (SDK mid-2026)
// ============================================================================

export type CodexServiceTier = "fast" | "flex";

export type CodexMessagePhase = "commentary" | "final_answer";

export type CodexDynamicToolCallStatus = "inProgress" | "completed" | "failed";

export type CodexModelUpgradeInfo = {
	model: string;
	upgradeCopy: string;
	modelLink: string;
	migrationMarkdown: string;
};

export type CodexModelAvailabilityNux = {
	message: string;
};

export type CodexInputModality = "text" | "image";

export type CodexCommandAction =
	| { type: "read"; command: string; name: string; path: string }
	| { type: "listFiles"; command: string; path?: string }
	| { type: "search"; command: string; query?: string; path?: string }
	| { type: "unknown"; command: string };
