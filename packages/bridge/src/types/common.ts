export type PermissionResponse = "once" | "always" | "reject" | "execpolicy";

// Session permission rules (OpenCode SDK v1.1.1+)
export type PermissionAction = "allow" | "deny" | "ask";

export type PermissionRule = {
	permission: string;
	pattern: string;
	action: PermissionAction;
};

export type PermissionRuleset = Array<PermissionRule>;

// Todo item from OpenCode SDK
// Note: SDK v1.2.1 removed `id` field. Bridge no longer sends it.
// Flutter generates a local id from content.hashCode for widget keys.
export type Todo = {
	content: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
	priority: "high" | "medium" | "low";
};

// Slash command from OpenCode SDK
// See: https://opencode.ai/docs/commands
export type CommandSource = "command" | "mcp" | "skill";

export type Command = {
	name: string;
	description?: string;
	source?: CommandSource;
	agent?: string; // Specific agent to use (e.g., "build", "plan")
	model?: string; // Specific model to use (e.g., "anthropic/claude-sonnet-4")
	template?: string; // Command template
	subtask?: boolean; // Run as background subtask
	hints: string[]; // Autocomplete hints
};

export type AgentModelRef = {
	modelID: string;
	providerID: string;
};

// Agent from OpenCode SDK
export type Agent = {
	name: string;
	description?: string;
	color?: string;
	mode: "primary" | "subagent" | "all";
	native?: boolean;
	hidden?: boolean;
	topP?: number;
	temperature?: number;
	permission?: PermissionRuleset;
	model?: AgentModelRef;
	variant?: string;
	prompt?: string;
	options?: Record<string, unknown>;
	steps?: number;
};

// Agent type for multi-agent support
export type AgentType = "opencode" | "claude-code" | "codex" | "pi" | "pi-durable";

export type ConnectionType = "local" | "unknown";

// Device information for multi-device support
export type DeviceInfo = {
	deviceId: string;
	deviceName: string;
	platform: string;
	connectionType: ConnectionType;
	rttMs: number;
	connectedAt: number;
	currentView?: { projectPath?: string; sessionId?: string };
};

export type StatusPayload = {
	// Legacy field (keep for backwards compatibility with older mobile builds)
	opencodeRunning: boolean;
	// Additive fields for multi-backend UX
	activeAgent?: AgentType;
	backends?: Record<AgentType, AgentStatusInfo>;
	// Bridge updater notifications
	updateAvailable?: boolean;
	latestVersion?: string;
	currentVersion?: string;
};

// NEW: Agent Status for multi-agent support
export type AgentStatusInfo = {
	available: boolean;
	authMethod?: string;
	version?: string;
};

// Feature 21: File Attachment (for @ tagging in prompt and image attachments)
export type FileAttachment = {
	path: string;
	isDirectory: boolean;
	// Image support fields (Phase 4)
	mimeType?: string; // e.g., "image/png", "image/jpeg"
	base64Data?: string; // Base64 encoded image data from mobile
};
