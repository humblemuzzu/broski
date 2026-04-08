export type PiStatePayload = {
	model: PiModelPayload | null;
	thinkingLevel: string;
	isStreaming: boolean;
	isCompacting: boolean;
	isRetrying: boolean;
	sessionFile: string | null;
	sessionId: string;
	sessionName: string | null;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
	isBashRunning: boolean;
	hasPendingBashMessages: boolean;
	retryAttempt: number;
};

export type PiModelPayload = {
	id: string;
	name: string;
	provider: string;
	api: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: string[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	authenticated: boolean;
	isOAuth: boolean;
};

export type PiSessionInfo = {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	allMessagesText?: string;
	summary?: { additions: number; deletions: number; files: number };
	subagentToolCount?: number; // Count of Task/oracle/finder/etc. tool invocations
};

export type PiCommandPayload = {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	location?: "user" | "project" | "path";
	path?: string;
};

export type PiToolInfo = {
	name: string;
	description: string;
	parameters?: any;
};

export type PiThinkingCapabilities = {
	supportsThinking: boolean;
	supportsXhigh: boolean;
	availableLevels: string[];
};

export type PiQueueState = {
	steering: string[];
	followUp: string[];
};

export type PiForkMessagePayload = {
	entryId: string;
	text: string;
};

export type PiStreamMessage =
	| { type: "agent-start" }
	| { type: "agent-end"; messages: any[] }
	| { type: "turn-start" }
	| { type: "turn-end"; message: any; toolResults: any[] }
	| { type: "message-start"; message: any }
	| { type: "message-end"; message: any }
	| { type: "text-delta"; content: string }
	| { type: "thinking-delta"; content: string }
	| { type: "tool-call-start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool-call-args-done"; toolCallId: string; toolName: string; args: any }
	| { type: "tool-exec-start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool-exec-update"; toolCallId: string; toolName: string; args?: any; partialResult: any }
	| { type: "tool-exec-end"; toolCallId: string; toolName: string; result: any; details?: any; isError: boolean }
	| { type: "message-done"; stopReason: string }
	| { type: "compaction-start"; reason: string }
	| { type: "compaction-end"; aborted: boolean; willRetry: boolean; errorMessage?: string }
	| { type: "retry-start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "retry-end"; success: boolean; attempt: number; finalError?: string }
	| { type: "extension-ui-request"; id: string; method: string; [key: string]: any }
	| { type: "error"; message: string; code?: string }
	| { type: "bash-output"; content: string }
	| { type: "queue-update"; steering: string[]; followUp: string[] }
	| { type: "external-user-message"; content: string; timestamp: number };
