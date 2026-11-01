import type { ServerWebSocket } from "bun";
import type { ClaudeElicitationReply } from "../handlers/cc_elicitation";
import type { PtyRuntime } from "../pty/runtime";
import type {
	AgentStatusInfo,
	AgentType,
	ClaudeCodeSession,
	ClaudeCodeStreamMessage,
	ClientMessage,
	DeviceInfo,
	ServerMessage,
} from "../types";
import type { BroskiSessionSummary } from "../types/runtime";

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

type ClaudeCodeConnector = typeof import("../connectors/claude-code");
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
	getBackendsStatus: () => Promise<Record<AgentType, AgentStatusInfo>>;
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
	mapClaudeCodeSessionToRuntimeSession: (session: ClaudeCodeSession) => BroskiSessionSummary;
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
	PERMISSION_TIMEOUT_MS: number;
	ptyRuntime: PtyRuntime;
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
