// Feature 15: MCP Server Status
export type McpServerStatus = {
	name: string;
	status:
		| "connected"
		| "disabled"
		| "failed"
		| "needs_auth"
		| "needs_client_registration"
		// Legacy values kept for backward compatibility
		| "disconnected"
		| "connecting"
		| "error";
	error?: string;
	tools?: string[];
	resources?: string[];
};

// MCP Resource (SDK v1.1.1+ experimental feature)
export type McpResource = {
	name: string;
	uri: string;
	description?: string;
	mimeType?: string;
	client: string; // Which MCP server provides this resource
};

// Git Worktree (SDK v1.1.1+ experimental feature)
export type Worktree = {
	name: string;
	branch: string;
	directory: string;
};

export type WorktreeCreateInput = {
	name?: string;
	startCommand?: string;
};

export type WorktreeResetInput = {
	directory: string;
};

// Feature 16: Provider Info
export type ProviderInfo = {
	all: ProviderDetails[];
	default: Record<string, string>;
	connected: string[];
};

export type ProviderDetails = {
	id: string;
	name: string;
	models: Record<string, ModelInfo>;
};

export type ModelInfo = {
	id: string;
	name: string;
	family?: string;
	contextWindow?: number;
	outputLimit?: number;
	reasoning?: boolean;
	attachment?: boolean;
	toolCall?: boolean;
	modalities?: {
		input: string[];
		output: string[];
	};
	status?: "alpha" | "beta" | "deprecated" | "active";
	experimental?: boolean;
	pricing?: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	variants?: Record<string, Record<string, unknown>>;
};

export type ProviderAuthPrompt =
	| {
			type: "text";
			key: string;
			message: string;
			placeholder?: string;
			when?: { key: string; op: "eq" | "neq"; value: string };
	  }
	| {
			type: "select";
			key: string;
			message: string;
			options: Array<{ label: string; value: string; hint?: string }>;
			when?: { key: string; op: "eq" | "neq"; value: string };
	  };

export type ProviderAuthMethod = {
	type: "api" | "oauth";
	label?: string;
	name?: string;
	description?: string;
	url?: string;
	prompts?: ProviderAuthPrompt[];
};

export type ProviderAuthAuthorization = {
	url: string;
	method: "auto" | "code";
	instructions: string;
};

// Feature 17: Tool Info
export type ToolInfo = {
	id: string;
	description?: string;
	parameters?: Record<string, unknown>;
};

// Feature 19: Formatter Info (matches SDK FormatterStatus shape)
export type FormatterInfo = {
	name: string;
	extensions: string[];
	enabled: boolean;
};
