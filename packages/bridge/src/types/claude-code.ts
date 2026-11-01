// CLAUDE CODE-SPECIFIC TYPES

// Claude Code Skill (auto-invoked capability)
export type ClaudeCodeSkill = {
	name: string;
	description?: string;
	autoInvoke: boolean;
	tags?: string[];
	license?: string;
	source?: "project" | "user" | "plugin";
	path?: string;
	agent?: string;
	context?: "fork";
};

// Claude Code Hook Event Types (SDK 0.2.87: 26 events)
export type ClaudeCodeHookEvent =
	| "PreToolUse"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "Notification"
	| "SessionStart"
	| "SessionEnd"
	| "Stop"
	| "StopFailure"
	| "PermissionRequest"
	| "UserPromptSubmit"
	| "SubagentStart"
	| "SubagentStop"
	| "TeammateIdle"
	| "TaskCreated"
	| "TaskCompleted"
	| "PreCompact"
	| "PostCompact"
	| "Setup"
	| "Elicitation"
	| "ElicitationResult"
	| "ConfigChange"
	| "WorktreeCreate"
	| "WorktreeRemove"
	| "InstructionsLoaded"
	| "CwdChanged"
	| "FileChanged";

// Claude Code Hook Configuration
export type ClaudeCodeHook = {
	id: string;
	event: ClaudeCodeHookEvent;
	matcher?: string; // Tool name pattern (e.g., 'Bash', 'Write|Edit')
	enabled: boolean;
	description?: string;
	hooks?: any[];
	source?: "project" | "user" | "plugin";
	path?: string;
};

// Claude Code Session
export type ClaudeCodeSession = {
	id: string;
	title?: string;
	cwd: string;
	model?: string;
	createdAt: number;
	updatedAt: number;
	messageCount?: number;
	isBackground?: boolean;
	hasSubagentActivity?: boolean;
	subagentName?: string;
	subagentCount?: number; // Number of subagent JSONL files under this session
	parentSessionId?: string; // For subagents: the parent session that spawned this agent
	gitBranch?: string;
	summary?: { additions: number; deletions: number; files: number };
	// SDK 0.2.87: SDKSessionInfo fields
	customTitle?: string; // User-set title via /rename
	firstPrompt?: string; // First meaningful user prompt
	tag?: string; // User-set session tag
	fileSize?: number; // JSONL file size in bytes
};

// Claude Code Command (slash command)
export type ClaudeCodeCommand = {
	name: string;
	description?: string;
	agent?: string;
	model?: string;
	subtask?: boolean;
	source?: "project" | "user" | "plugin";
	path?: string;
};

// Claude Code Permission Mode
export type ClaudeCodePermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions" | "dontAsk" | "auto";

export type ClaudeCodeBeta = "context-1m-2025-08-07";

export type ClaudeCodeSystemPrompt = string | { type: "preset"; preset: "claude_code"; append?: string } | null;

export type ClaudeCodeOutputFormat = {
	type: "json_schema";
	schema: Record<string, unknown>;
};

export type ClaudeCodeSandboxNetworkConfig = {
	allowedDomains?: string[];
	allowManagedDomainsOnly?: boolean;
	allowUnixSockets?: string[];
	allowAllUnixSockets?: boolean;
	allowLocalBinding?: boolean;
	httpProxyPort?: number;
	socksProxyPort?: number;
};

export type ClaudeCodeSandboxSettings = {
	enabled?: boolean;
	autoAllowBashIfSandboxed?: boolean;
	allowUnsandboxedCommands?: boolean;
	network?: ClaudeCodeSandboxNetworkConfig;
	filesystem?: {
		allowWrite?: string[];
		denyWrite?: string[];
		denyRead?: string[];
	};
	ignoreViolations?: Record<string, string[]>;
	enableWeakerNestedSandbox?: boolean;
	excludedCommands?: string[];
	ripgrep?: { command: string; args?: string[] };
};

// Claude Code Filesystem Agent (discovered from .claude/agents/*.md)
export type ClaudeCodeFilesystemAgent = {
	name: string; // Derived from filename (without .md)
	description?: string; // From frontmatter or first paragraph
	prompt?: string; // Full markdown content (the agent's instructions)
	tools?: string[]; // From frontmatter 'tools' field
	model?: string; // From frontmatter 'model' field
	memory?: "user" | "project" | "local"; // From frontmatter 'memory' field
	background?: boolean; // From frontmatter 'background' field (always run as background task)
	isolation?: "worktree"; // From frontmatter 'isolation' field
	source: "project" | "user"; // Project-level (.claude/agents/) or user-level (~/.claude/agents/)
	path: string; // Absolute path to the .md file
};

// Claude Code Memory Entry (from ~/.claude/memory/ or .claude/memory/)
export type ClaudeCodeMemoryEntry = {
	scope: "user" | "project" | "local";
	filename: string; // e.g. "2025-02-07T12-00-00.md"
	content: string; // Full markdown content
	createdAt?: string; // ISO date from filename or stat
	path: string; // Absolute path to the file
	source?: "auto" | "manual" | "unknown"; // Best-effort classifier for auto-memory entries
};

// Claude Code Subagent Definition (matches SDK AgentDefinition)
export type ClaudeCodeSubagent = {
	name: string; // Unique identifier for the subagent
	description: string; // When Claude should use this subagent
	prompt: string; // System prompt for the subagent
	tools?: string[]; // Allowed tools (inherits if omitted)
	model?: "sonnet" | "opus" | "haiku" | "inherit"; // Model override
	permissionMode?: ClaudeCodePermissionMode;
	disallowedTools?: string[];
	skills?: string[]; // Skills to preload
	maxTurns?: number; // Max agentic turns
	mcpServers?: Array<string | Record<string, unknown>>; // Per-subagent MCP servers (B14)
	background?: boolean; // Run this subagent as background task by default
	isolation?: "worktree"; // Run this subagent in isolated git worktree
	initialPrompt?: string; // SDK 0.2.87: Auto-submitted as first user turn
	memory?: "user" | "project" | "local"; // SDK 0.2.92: Memory scope for subagent
	effort?: ClaudeCodeEffort | number; // SDK 0.2.92: Reasoning effort level
};

// Claude Code Custom Tool Parameter
export type ClaudeCodeCustomToolParameter = {
	name: string;
	type: "string" | "number" | "boolean" | "array" | "object";
	description?: string;
	required?: boolean;
	default?: unknown;
	enum?: string[]; // For string types with fixed options
};

// Claude Code Custom Tool HTTP Handler Config
export type ClaudeCodeHttpHandlerConfig = {
	url: string;
	method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
	headers?: Record<string, string>;
	bodyTemplate?: string; // JSON template with {{param}} placeholders
};

// Claude Code Custom Tool Script Handler Config
export type ClaudeCodeScriptHandlerConfig = {
	command: string;
	args?: string[];
	cwd?: string;
	timeout?: number;
	shell?: boolean;
};

// Claude Code Custom Tool Builtin Handler Config (reserved)
export type ClaudeCodeBuiltinHandlerConfig = {
	action: string;
	config?: Record<string, unknown>;
};

// Claude Code Custom Tool Definition
export type ClaudeCodeCustomTool = {
	id: string;
	name: string;
	description: string;
	parameters: ClaudeCodeCustomToolParameter[];
	handler: "http" | "script" | "builtin";
	handlerConfig: ClaudeCodeHttpHandlerConfig | ClaudeCodeScriptHandlerConfig | ClaudeCodeBuiltinHandlerConfig;
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
};

// CLAUDE CODE PLUGIN TYPES

// Plugin manifest from plugin.json
export type ClaudeCodePluginManifest = {
	name: string;
	version?: string;
	description?: string;
	author?: {
		name?: string;
		email?: string;
		url?: string;
	};
	homepage?: string;
	repository?: string;
	license?: string;
	keywords?: string[];
};

// Plugin status
export type ClaudeCodePluginStatus = "enabled" | "disabled" | "error";

// Full plugin definition
export type ClaudeCodePlugin = {
	name: string;
	path: string; // Absolute path to plugin directory
	status: ClaudeCodePluginStatus;
	manifest?: ClaudeCodePluginManifest;
	// Discovered components
	commands?: string[]; // Slash commands provided by plugin
	agents?: string[]; // Agent definitions
	skills?: string[]; // Skills provided
	hasHooks?: boolean; // Has hooks.json
	hasMcpServers?: boolean; // Has MCP server configs
	// Runtime info
	loadedAt?: number; // When plugin was last loaded
	error?: string; // Error message if status is 'error'
};

// Plugin configuration (what we store in ~/.broski/plugins-config.json)
export type ClaudeCodePluginConfig = {
	enabled: string[]; // Plugin names that are enabled
	disabled: string[]; // Plugin names that are explicitly disabled
	customPaths: string[]; // Additional plugin paths to scan
};

// Claude Code Thinking Option (SDK 0.2.42+)
export type ClaudeCodeThinkingOption =
	| { type: "adaptive" }
	| { type: "enabled"; budgetTokens: number }
	| { type: "disabled" };

// Claude Code Effort Level (SDK 0.2.42+)
export type ClaudeCodeEffort = "low" | "medium" | "high" | "max";

// Claude Code Configuration
export type ClaudeCodeConfig = {
	permissionMode: ClaudeCodePermissionMode;
	allowedTools: string[];
	disallowedTools: string[];
	model?: string;
	systemPrompt?: ClaudeCodeSystemPrompt;
	maxTurns?: number;
	maxBudgetUsd?: number;
	betas?: ClaudeCodeBeta[];
	sandbox?: ClaudeCodeSandboxSettings;
	outputFormat?: ClaudeCodeOutputFormat;
	enableAgentTeams?: boolean;
	thinking?: ClaudeCodeThinkingOption;
	effort?: ClaudeCodeEffort;
	promptSuggestions?: boolean;
	// When false, disables claude.ai-managed MCP servers (CLAUDE_CODE env flag).
	enableClaudeAiMcpServers?: boolean;
	// Project/user settings (persisted in Claude Code settings.json)
	language?: string;
	releaseChannel?: "stable" | "latest";
	respectGitignore?: boolean;
	subagents?: ClaudeCodeSubagent[]; // Custom subagent definitions
	activeSubagent?: string; // Currently selected subagent name
	agentProgressSummaries?: boolean; // SDK 0.2.74: AI-generated summaries for subagent progress
	fallbackModel?: string; // Persistent fallback model for auto-retry
};
