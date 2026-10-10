export type BroskiBackend = "opencode" | "claude-code" | "codex" | "pi" | "pi-durable";

export type BroskiBackendData = Record<string, unknown>;

export type BroskiPermissionRequest = {
	requestId?: string;
	kind?: string;
	title?: string;
	message?: string;
	options?: string[];
	metadata?: Record<string, unknown>;
};

export type BroskiUserInputRequest = {
	requestId?: string;
	kind?: string;
	title?: string;
	prompt?: string;
	placeholder?: string;
	options?: string[];
	metadata?: Record<string, unknown>;
};

export type BroskiSessionDiffSummary = {
	additions: number;
	deletions: number;
	files: number;
};

export type BroskiModelSummary = {
	id: string;
	backend: BroskiBackend;
	label: string;
	providerId?: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	supportsReasoning?: boolean;
	supportsImages?: boolean;
	supportsTools?: boolean;
	supportsMcp?: boolean;
	backendData?: BroskiBackendData;
};

export type BroskiRuntimeCapabilities = {
	canStreamText: boolean;
	canStreamThinking: boolean;
	canUseTools: boolean;
	canPrompt: boolean;
	canAbort: boolean;
	canSwitchModel: boolean;
	canListSessions: boolean;
	canReadTranscript: boolean;
	canForkSession: boolean;
	canCompact: boolean;
	canRetry: boolean;
	canRequestUserInput: boolean;
	canRequestPermissions: boolean;
	backendExtras: string[];
};

export type BroskiRuntimeState = {
	backend: BroskiBackend;
	sessionId?: string;
	cwd?: string;
	isStreaming: boolean;
	isCompacting: boolean;
	isRetrying: boolean;
	pendingMessageCount?: number;
	model?: BroskiModelSummary;
	thinkingLevel?: string;
	permissionRequest?: BroskiPermissionRequest;
	capabilities: BroskiRuntimeCapabilities;
	backendData?: BroskiBackendData;
};

export type BroskiSessionKind = "root" | "subagent" | "fork" | "handoff";

export type BroskiSessionSummary = {
	id: string;
	backend: BroskiBackend;
	title: string;
	cwd: string;
	createdAtMs: number;
	updatedAtMs: number;
	isActive?: boolean;
	modelLabel?: string;
	summary?: BroskiSessionDiffSummary;
	parentSessionId?: string;
	childSessionCount?: number;
	sessionKind?: BroskiSessionKind;
	subagentType?: string;
	backendData?: BroskiBackendData;
};

type BroskiRuntimeEventEnvelope<TType extends string> = {
	type: TType;
	backend: BroskiBackend;
	timestampMs: number;
	sessionId?: string;
	cwd?: string;
	messageId?: string;
	toolCallId?: string;
	streamId?: string;
	turnId?: string;
	seq?: number;
	/** Present on a coalesced delta only: the seq of the first delta merged into it. */
	seqStart?: number;
	replayed?: boolean;
	backendData?: BroskiBackendData;
};

export type BroskiAgentStartedEvent = BroskiRuntimeEventEnvelope<"agent_started">;

export type BroskiAgentFinishedEvent = BroskiRuntimeEventEnvelope<"agent_finished"> & {
	stopReason?: string;
};

export type BroskiAssistantTextDeltaEvent = BroskiRuntimeEventEnvelope<"assistant_text_delta"> & {
	delta: string;
};

export type BroskiAssistantThinkingDeltaEvent = BroskiRuntimeEventEnvelope<"assistant_thinking_delta"> & {
	delta: string;
};

export type BroskiToolStartedEvent = BroskiRuntimeEventEnvelope<"tool_started"> & {
	toolName?: string;
	input?: unknown;
};

export type BroskiToolUpdatedEvent = BroskiRuntimeEventEnvelope<"tool_updated"> & {
	toolName?: string;
	input?: unknown;
	partialOutput?: unknown;
};

export type BroskiToolFinishedEvent = BroskiRuntimeEventEnvelope<"tool_finished"> & {
	toolName?: string;
	input?: unknown;
	output?: unknown;
	isError?: boolean;
};

export type BroskiPermissionRequestedEvent = BroskiRuntimeEventEnvelope<"permission_requested"> & {
	request: BroskiPermissionRequest;
};

export type BroskiUserInputRequestedEvent = BroskiRuntimeEventEnvelope<"user_input_requested"> & {
	request: BroskiUserInputRequest;
};

export type BroskiSessionStateChangedEvent = BroskiRuntimeEventEnvelope<"session_state_changed"> & {
	state: BroskiRuntimeState;
};

export type BroskiCompactionStartedEvent = BroskiRuntimeEventEnvelope<"compaction_started"> & {
	reason?: string;
};

export type BroskiCompactionFinishedEvent = BroskiRuntimeEventEnvelope<"compaction_finished"> & {
	aborted?: boolean;
	willRetry?: boolean;
	errorMessage?: string;
};

export type BroskiRetryStartedEvent = BroskiRuntimeEventEnvelope<"retry_started"> & {
	attempt?: number;
	maxAttempts?: number;
	delayMs?: number;
	errorMessage?: string;
};

export type BroskiRetryFinishedEvent = BroskiRuntimeEventEnvelope<"retry_finished"> & {
	success?: boolean;
	attempt?: number;
	finalError?: string;
};

export type BroskiErrorEvent = BroskiRuntimeEventEnvelope<"error"> & {
	message: string;
	code?: string;
	details?: unknown;
};

export type BroskiBackendEvent = BroskiRuntimeEventEnvelope<"backend_event"> & {
	kind: string;
	payload: unknown;
};

export type BroskiRuntimeEvent =
	| BroskiAgentStartedEvent
	| BroskiAgentFinishedEvent
	| BroskiAssistantTextDeltaEvent
	| BroskiAssistantThinkingDeltaEvent
	| BroskiToolStartedEvent
	| BroskiToolUpdatedEvent
	| BroskiToolFinishedEvent
	| BroskiPermissionRequestedEvent
	| BroskiUserInputRequestedEvent
	| BroskiSessionStateChangedEvent
	| BroskiCompactionStartedEvent
	| BroskiCompactionFinishedEvent
	| BroskiRetryStartedEvent
	| BroskiRetryFinishedEvent
	| BroskiErrorEvent
	| BroskiBackendEvent;
