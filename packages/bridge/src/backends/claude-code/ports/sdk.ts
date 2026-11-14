/** `ClaudeSdk`: the only way any part of the adapter reaches the SDK at run time, so tests can stand one in (D6). */

import type {
	ForkSessionOptions,
	ForkSessionResult,
	GetSessionInfoOptions,
	GetSessionMessagesOptions,
	GetSubagentMessagesOptions,
	ListSessionsOptions,
	ListSubagentsOptions,
	Options,
	Query,
	ResolvedSettings,
	ResolveSettingsOptions,
	SDKSessionInfo,
	SDKUserMessage,
	SessionMessage,
	SessionMutationOptions,
	Settings,
} from "@anthropic-ai/claude-agent-sdk";

type NoStore<T> = Omit<T, "sessionStore">;

/**
 * The SDK's in-process session and settings functions: file I/O on the config dir, no CLI. They throw as the SDK
 * does; the caller turns a throw into a `Rejected`.
 */
export interface SessionFunctions {
	/** Newest `lastModified` first, then the greater `sessionId` first. */
	listSessions(options: NoStore<ListSessionsOptions>): Promise<SDKSessionInfo[]>;
	getSessionInfo(sessionId: string, options?: NoStore<GetSessionInfoOptions>): Promise<SDKSessionInfo | undefined>;
	/** The live `parentUuid` chain, oldest first; `[]` for an unknown session. */
	getSessionMessages(sessionId: string, options?: NoStore<GetSessionMessagesOptions>): Promise<SessionMessage[]>;
	getSubagentMessages(
		sessionId: string,
		agentId: string,
		options?: NoStore<GetSubagentMessagesOptions>,
	): Promise<SessionMessage[]>;
	listSubagents(sessionId: string, options?: NoStore<ListSubagentsOptions>): Promise<string[]>;
	/** `upToMessageId` is inclusive; every uuid is remapped. */
	forkSession(sessionId: string, options?: NoStore<ForkSessionOptions>): Promise<ForkSessionResult>;
	renameSession(sessionId: string, title: string, options?: NoStore<SessionMutationOptions>): Promise<void>;
	resolveSettings(options?: ResolveSettingsOptions): Promise<ResolvedSettings>;
}

/** Never a string prompt (D1): a string closes stdin at the end of the first run. */
export interface QueryParams {
	readonly prompt: AsyncIterable<SDKUserMessage>;
	readonly options: Options;
}

export interface ClaudeSdk extends SessionFunctions {
	query(params: QueryParams): Query;
	filterEscalatingDefaultMode(resolved: ResolvedSettings): Settings;
	/** The config dir the functions above read, resolved as the SDK resolves it; for paths it has no function for. */
	configRoot(): string;
	/** Idempotent; a session function called after it rejects. */
	dispose(): Promise<void>;
}

export type InterruptReceipt = Awaited<ReturnType<Query["interrupt"]>>;

/** The argument `Query.interrupt` takes at run time but does not declare; pass it through `interruptQuery`. */
export interface InterruptOptions {
	readonly cancelQueued?: boolean;
}

/** A `command_lifecycle` frame, which the `SDKMessage` union lacks; read it with `asCommandLifecycle`. */
export interface CommandLifecycle {
	readonly type: "command_lifecycle";
	/** The send's `uuid`, which is the prompt's `clientRequestId` (D10). */
	readonly commandUuid: string;
	/** `queued`, `started`, `completed` or `cancelled` so far; a string, since the CLI may add states. */
	readonly state: string;
}
