export type PermissionResponse = "once" | "always" | "reject";

// Agent type for multi-agent support
export type AgentType = "claude-code";

// Device information for multi-device support
export type DeviceInfo = {
	deviceId: string;
	deviceName: string;
	platform: string;
	rttMs: number;
	connectedAt: number;
	currentView?: { projectPath?: string; sessionId?: string };
};

export type StatusPayload = {
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
