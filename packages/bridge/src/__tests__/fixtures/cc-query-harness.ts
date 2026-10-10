import { queryClaudeCode } from "../../connectors/claude-code/query";
import type {
	ClaudeCodeQueryOptions,
	ElicitationRequestHandler,
	PermissionRequestHandler,
	SdkOptions,
} from "../../connectors/claude-code/query-context";
import {
	activeSessions,
	ccAccountInfoByCwd,
	ccMcpStatusByCwd,
	ccSupportedModelsByCwd,
	setCurrentConfig,
} from "../../connectors/claude-code/shared";
import { setClaudeAgentSdkForTests } from "../../sdk/claude-agent-sdk";
import type { ClaudeCodeConfig, ClaudeCodeStreamMessage } from "../../types";

export type CapturedQuery = {
	prompt: string | undefined;
	options: SdkOptions | undefined;
	count: number;
};

const BASE_CONFIG: ClaudeCodeConfig = {
	permissionMode: "default",
	allowedTools: ["Read", "Bash"],
	disallowedTools: [],
	model: "sonnet",
	betas: [],
	enableAgentTeams: false,
	promptSuggestions: false,
	systemPrompt: { type: "preset", preset: "claude_code" },
	respectGitignore: true,
};

export function resetClaudeCodeState(overrides: Partial<ClaudeCodeConfig> = {}): void {
	setCurrentConfig({ ...BASE_CONFIG, ...overrides });
	activeSessions.clear();
	ccAccountInfoByCwd.clear();
	ccMcpStatusByCwd.clear();
	ccSupportedModelsByCwd.clear();
}

function fakeQueryObject(messages: unknown[], throwAfterMessages?: Error) {
	const generator = (async function* () {
		for (const message of messages) yield message;
		if (throwAfterMessages) throw throwAfterMessages;
	})();
	return Object.assign(generator, {
		supportedModels: async () => [],
		accountInfo: async () => ({}),
		mcpServerStatus: async () => [],
		interrupt: async () => {},
		setPermissionMode: async () => {},
		setModel: async () => {},
		setMaxThinkingTokens: async () => {},
	});
}

export function installFakeClaudeSdk(messages: unknown[], throwAfterMessages?: Error): CapturedQuery {
	const captured: CapturedQuery = { prompt: undefined, options: undefined, count: 0 };
	const queryFn = (params: { prompt: string; options?: SdkOptions }) => {
		captured.prompt = params.prompt;
		captured.options = params.options;
		captured.count += 1;
		return fakeQueryObject(messages, throwAfterMessages);
	};
	setClaudeAgentSdkForTests({ query: queryFn } as unknown as typeof import("@anthropic-ai/claude-agent-sdk"));
	return captured;
}

export function installFailingClaudeSdk(error: Error): void {
	setClaudeAgentSdkForTests({
		query: () => {
			throw error;
		},
	} as unknown as typeof import("@anthropic-ai/claude-agent-sdk"));
}

export function uninstallFakeClaudeSdk(): void {
	setClaudeAgentSdkForTests(null);
}

export async function runFailingQuery(error: Error): Promise<{ error: Error | null; completedWith: string | null }> {
	installFailingClaudeSdk(error);
	const result: { error: Error | null; completedWith: string | null } = { error: null, completedWith: null };
	await queryClaudeCode(
		"hello",
		{ cwd: "/repo" },
		() => {},
		(sessionId) => {
			result.completedWith = sessionId;
		},
		(err) => {
			result.error = err;
		},
	);
	return result;
}

export function normalizeEvent(message: ClaudeCodeStreamMessage): Record<string, unknown> {
	const record: Record<string, unknown> = { ...message };
	return "timestamp" in record ? { ...record, timestamp: 0 } : record;
}

export type RunResult = {
	events: Record<string, unknown>[];
	completedWith: string | null;
	error: Error | null;
	captured: CapturedQuery;
};

export async function runQuery(
	messages: unknown[],
	options: ClaudeCodeQueryOptions,
	prompt = "hello",
	handlers: {
		onPermissionRequest?: PermissionRequestHandler;
		onElicitationRequest?: ElicitationRequestHandler;
	} = {},
	throwAfterMessages?: Error,
): Promise<RunResult> {
	const captured = installFakeClaudeSdk(messages, throwAfterMessages);
	const events: Record<string, unknown>[] = [];
	let completedWith: string | null = null;
	let error: Error | null = null;

	await queryClaudeCode(
		prompt,
		options,
		(message) => events.push(normalizeEvent(message)),
		(sessionId) => {
			completedWith = sessionId;
		},
		(err) => {
			error = err;
		},
		handlers.onPermissionRequest,
		handlers.onElicitationRequest,
	);

	return { events, completedWith, error, captured };
}

export const INIT_MESSAGE = {
	type: "system",
	subtype: "init",
	session_id: "ses_cc_1",
	model: "claude-sonnet",
	permissionMode: "default",
	tools: ["Read", "Bash"],
	slash_commands: ["/compact"],
	skills: [],
	agents: [],
	mcp_servers: [{ name: "srv", status: "connected" }],
	plugins: [],
	apiKeySource: "user",
	claude_code_version: "1.2.3",
	cwd: "/repo",
	uuid: "u0",
	betas: ["context-1m-2025-08-07"],
	output_style: "default",
};

export const SESSION_CREATED_EVENT = {
	type: "session-created",
	sessionId: "ses_cc_1",
	agent: "claude-code",
	model: "claude-sonnet",
};

export const SESSION_INIT_EVENT = {
	type: "session-init",
	sessionId: "ses_cc_1",
	model: "claude-sonnet",
	permissionMode: "default",
	tools: ["Read", "Bash"],
	slashCommands: ["/compact"],
	skills: [],
	agents: [],
	mcpServers: [{ name: "srv", status: "connected" }],
	plugins: [],
	apiKeySource: "user",
	claudeCodeVersion: "1.2.3",
	betas: ["context-1m-2025-08-07"],
	outputStyle: "default",
	cwd: "/repo",
	supportedModels: undefined,
	accountInfo: { apiProvider: null },
};
