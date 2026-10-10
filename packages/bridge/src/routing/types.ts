import type { ServerWebSocket } from "bun";
import type { CodexAppServerClient } from "../connectors/codex";
import type { OpenCodeConnector } from "../connectors/opencode";
import type { ClaudeElicitationReply } from "../handlers/cc_elicitation";
import type { PtyRuntime } from "../pty/runtime";
import type { PiDurableSocketPool } from "../transport/pi-durable-socket";
import type {
	AgentStatusInfo,
	AgentType,
	ClaudeCodeSession,
	ClaudeCodeStreamMessage,
	ClaudeCodeSupportedModel,
	ClientMessage,
	CodexStreamMessage,
	CodexThread,
	DeviceInfo,
	PermissionResponse,
	ServerMessage,
	SessionStatusInfo,
} from "../types";
import type { BroskiModelSummary, BroskiSessionSummary } from "../types/runtime";

export type Reply = (message: ServerMessage) => void;

export type MessageType = ClientMessage["type"];

export type ClientMessageOf<T extends MessageType> = Extract<ClientMessage, { type: T }>;

export type ConnectionContext = {
	projectPath?: string;
	sessionId?: string;
	viewAgent?: AgentType;
	lastPongAt: number;
	lastRttMs: number;
	pendingPing?: { id: string; sentAt: number };
	connectionType: "local" | "tailscale" | "unknown";
	deviceId?: string;
	deviceName?: string;
	platform?: string;
	protocolVersion?: string;
	connectedAt: number;
	[key: string]: unknown;
};

export type PermissionWaiter = {
	resolve: (response: {
		response: "once" | "always" | "reject";
		updatedInput?: Record<string, unknown>;
		updatedPermissions?: unknown[];
		decisionClassification?: string;
	}) => void;
	timer: Timer;
};

export type ElicitationWaiter = {
	resolve: (response: ClaudeElicitationReply) => void;
	timer: Timer;
};

export type ApprovalWaiter = {
	resolve: (response: {
		response?: PermissionResponse;
		execpolicyAmendment?: unknown;
		networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
		answers?: Record<string, { answers: string[] }>;
	}) => void;
	timer: Timer;
};

export type CxProjectCacheEntry = { fetchedAt: number; data: unknown[] };
export type CxThreadCacheEntry = { fetchedAt: number; data: CodexThread[]; nextCursor: string | null };

type ClaudeCodeConnector = typeof import("../connectors/claude-code");
type CodexFsConnector = typeof import("../connectors/codex-fs");
type FileSearchConnector = typeof import("../file-search");

/**
 * Everything a message handler can reach on the running bridge, minus the two
 * values that change per message (`ws`, `reply`). `server.ts` builds this once
 * and `RequestContext` spreads it per message.
 */
export type ServerDeps = {
	contexts: Map<ServerWebSocket<unknown>, ConnectionContext>;
	sockets: Set<ServerWebSocket<unknown>>;
	send: (ws: ServerWebSocket<unknown>, message: ServerMessage) => void;
	sendStatus: (ws: ServerWebSocket<unknown>) => Promise<void>;
	broadcast: (message: ServerMessage) => void;
	broadcastToSessionWatchers: (
		agent: AgentType,
		sessionId: string,
		message: ServerMessage,
		excludeWs?: ServerWebSocket<unknown> | null,
	) => void;
	log: (message: string) => void;
	logUser: (message: string) => void;
	logInfo: (message: string) => void;
	logDebug: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
	DEBUG_RTS: boolean;
	DEBUG_CX_GLOBAL: boolean;
	BRIDGE_PROTOCOL_VERSION: string;
	ALLOWED_DEVICE_IDS: Set<string>;
	getDeviceInfo: (ws: ServerWebSocket<unknown>) => DeviceInfo | null;
	getAllDevices: () => DeviceInfo[];
	findSocketByDeviceId: (deviceId: string) => ServerWebSocket<unknown> | null;
	/** Claude Code subagent inspection (SDK functions, resolved on demand). */
	getClaudeCodeChildren: () => Promise<{
		listSubagents: (sessionId: string, cwd?: string) => Promise<string[]>;
		getSubagentMessages: (sessionId: string, agentId: string, cwd?: string) => Promise<unknown[]>;
	}>;
	claudeCode: ClaudeCodeConnector;
	opencode: OpenCodeConnector | null;
	codexFs: CodexFsConnector;
	ensureCodexClient: () => Promise<CodexAppServerClient>;
	codexClient: CodexAppServerClient | null;
	requireOpenCode: () => OpenCodeConnector;
	requireOpenCodeOrNull: () => OpenCodeConnector | null;
	checkCodexAvailable: () => Promise<boolean>;
	getBackendsStatus: () => Promise<Record<AgentType, AgentStatusInfo>>;
	restartOpenCode?: () => Promise<boolean | undefined>;
	safeString: (value: unknown) => string;
	getSecurePath: (path: string) => Promise<string | null>;
	isSafeClaudeCommandName: (name: string) => boolean;
	resolveClaudeCommandFilePath: (params: { cwd: string; source: "project" | "user"; name: string }) => string | null;
	readFileDirectly: (filePath: string) => Promise<{
		type: "text" | "binary";
		content: string;
		mime: string;
		mimeType: string;
		encoding?: "base64";
	}>;
	readFileBinaryDirectly: (
		filePath: string,
		maxSizeMb?: number,
	) => Promise<
		| { base64: string; mime: string; size: number }
		| { error: "not_found" | "too_large" | "access_denied"; size?: number }
	>;
	listFilesDirectly: (
		filePath: string,
	) => Promise<Array<{ name: string; type: "file" | "directory"; path: string; absolute: string }>>;
	fileSearch: FileSearchConnector;
	recentChatMessageIds: Map<string, number>;
	ccSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ccSessionCwds: Map<string, string>;
	ccEventBuffers: Map<string, Array<{ event: unknown; ts: number }>>;
	ccPermissionWaiters: Map<string, PermissionWaiter>;
	ccElicitationWaiters: Map<string, ElicitationWaiter>;
	cxApprovalWaiters: Map<string, ApprovalWaiter>;
	cxActiveTurns: Map<string, string>;
	cxThreadOwners: Map<string, ServerWebSocket<unknown>>;
	cxThreadCwds: Map<string, string>;
	cxThreadNames: Map<string, string>;
	cxThreadCache: Map<string, CxThreadCacheEntry>;
	cxProjectCache: CxProjectCacheEntry | null;
	setProjectCache: (cache: CxProjectCacheEntry | null) => void;
	cxSearchSessions: Map<string, string>;
	CODEX_PROJECT_CACHE_TTL_MS: number;
	CODEX_THREAD_CACHE_TTL_MS: number;
	invalidateCodexCaches: (cwd?: string) => void;
	ensureUndoStack: (threadId: string) => string[];
	applyCodexUndo: (threadId: string, key: string) => Promise<string[]>;
	mapCodexThread: (thread: unknown, nameOverride?: string) => CodexThread & { threadName?: string };
	mapCodexThreadToRuntimeSession: (thread: CodexThread) => BroskiSessionSummary;
	mapClaudeCodeSessionToRuntimeSession: (session: ClaudeCodeSession) => BroskiSessionSummary;
	mapClaudeCodeModelToSummary: (model: ClaudeCodeSupportedModel) => BroskiModelSummary;
	ocSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ocSessionProjectPaths: Map<string, string>;
	sessionWatchers: Map<string, Set<ServerWebSocket<unknown>>>;
	updateSessionWatchers: (ws: ServerWebSocket<unknown>, prevKey: string | null, nextKey: string | null) => void;
	makeSessionKey: (agent: AgentType | undefined, sessionId: string | undefined) => string | null;
	syncExternalTailForKey: (key: string | null) => void;
	ensureClaudeWatchDir: (
		path: string,
		kind: "skills" | "plugins" | "hooks" | "commands" | "mcp",
		cwd?: string,
		recursive?: boolean,
	) => void;
	currentAgent: AgentType;
	getCurrentAgent: () => AgentType;
	setCurrentAgent: (agent: AgentType) => void;
	buildClaudeCodeRuntimeState: (params: {
		sessionId: string;
		cwd?: string;
		isStreaming: boolean;
	}) => Record<string, unknown>;
	buildCodexRuntimeState: (params: { threadId: string; cwd?: string; isStreaming: boolean }) => Record<string, unknown>;
	mapOpenCodeStatusToRuntimeState: (
		sessionId: string,
		status: SessionStatusInfo,
		projectPath?: string,
	) => Record<string, unknown>;
	listPiActiveSessionSnapshots: () => unknown[];
	buildPiActiveRuntimeStateMessages: () => ServerMessage[];
	findPiActiveRuntimeStateMessage: (sessionId: string) => ServerMessage | null;
	replayRuntimeEventsSince: (params: {
		ws: ServerWebSocket<unknown>;
		backend: AgentType;
		sessionId?: string;
		cwd?: string;
		lastSeq?: number;
	}) => number;
	emitCcStream: (
		sessionId: string,
		streamMessage: ClaudeCodeStreamMessage,
		owner?: ServerWebSocket<unknown> | null,
	) => void;
	emitCxStream: (threadId: string, streamMessage: CodexStreamMessage, owner?: ServerWebSocket<unknown> | null) => void;
	enqueueSdkEvent: (event: unknown) => void;
	PERMISSION_TIMEOUT_MS: number;
	ptyRuntime: PtyRuntime;
	piDurableSockets: PiDurableSocketPool;
};

export type RequestContext = ServerDeps & {
	ws: ServerWebSocket<unknown>;
	reply: Reply;
};

/** A handler owns exactly one message type; the message is narrowed for it. */
export type Handler<T extends MessageType> = (message: ClientMessageOf<T>, ctx: RequestContext) => Promise<void>;

/** Registration surface used by handler modules. */
export type MessageRouter = {
	register<T extends MessageType>(type: T, handler: Handler<T>): void;
};
