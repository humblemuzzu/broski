import type { ServerWebSocket } from "bun";
import type { AuthTokenState } from "../auth-token";
import type { CodexAppServerClient } from "../connectors/codex";
import type { OpenCodeConnector } from "../connectors/opencode";
import type { ClaudeElicitationReply } from "../handlers/cc_elicitation";
import { isCompiledBinary } from "../platform";
import { PtyManager } from "../pty/manager";
import type { ConnectionContext } from "../routing/types";
import { BoundedMap, registerSweepable } from "../state/bounded-map";
import { isTlsEnabledByEnv, type TlsMaterial } from "../tls";
import { PiDurableSocketPool } from "../transport/pi-durable-socket";
import type { AgentType, PermissionResponse } from "../types";
import { RuntimeSendQueue } from "../utils/runtime-send-queue";
import type { PermissionWaiter } from "./permission-waiter";

export type ClaudePermissionReply = {
	response: "once" | "always" | "reject";
	updatedInput?: Record<string, unknown>;
};

export type CodexApprovalReply = {
	response?: PermissionResponse;
	execpolicyAmendment?: any;
	networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
	answers?: Record<string, { answers: string[] }>;
};

export type ElicitationWaiter = PermissionWaiter<ClaudeElicitationReply>;

export type BufferedStreamEvent = { event: any; ts: number };

/**
 * Everything the sections of the bridge server share and mutate over the daemon's lifetime.
 * Built once by `createBridgeServer` and handed to each section factory so no section owns
 * another's state.
 */
export type BridgeState = {
	sockets: Set<ServerWebSocket<unknown>>;
	contexts: Map<ServerWebSocket<unknown>, ConnectionContext>;
	compiled: boolean;
	webDistDir: string;
	tlsEnabled: boolean;
	allowTokenInUrl: boolean;
	tlsMaterial: TlsMaterial | null;
	authState: AuthTokenState;
	authToken: string;
	authExpiresAt: number;
	currentAgent: AgentType;
	codexClient: CodexAppServerClient | null;
	ptyManager: PtyManager;
	runtimeSendQueue: RuntimeSendQueue;
	piDurableSockets: PiDurableSocketPool;
	sessionWatchers: Map<string, Set<ServerWebSocket<unknown>>>;
	ccExternalTails: Map<string, { stop: () => void }>;
	cxExternalTails: Map<string, { stop: () => void }>;
	ocExternalTails: Map<string, { stop: () => void }>;
	ccPermissionWaiters: Map<string, PermissionWaiter<ClaudePermissionReply>>;
	ccElicitationWaiters: Map<string, ElicitationWaiter>;
	cxApprovalWaiters: Map<string, PermissionWaiter<CodexApprovalReply>>;
	ccSessionOwners: Map<string, ServerWebSocket<unknown>>;
	cxThreadOwners: Map<string, ServerWebSocket<unknown>>;
	ocSessionOwners: Map<string, ServerWebSocket<unknown>>;
	cxItemCache: Map<string, any>;
	ccEventBuffers: Map<string, BufferedStreamEvent[]>;
	cxEventBuffers: Map<string, BufferedStreamEvent[]>;
	recentChatMessageIds: Map<string, number>;
	lastGitBranchByProject: Map<string, string>;
	ocSessionProjectPaths: BoundedMap<string, string>;
	ccSessionCwds: BoundedMap<string, string>;
	cxActiveTurns: BoundedMap<string, string>;
	cxThreadCwds: BoundedMap<string, string>;
	cxThreadNames: BoundedMap<string, string>;
	cxSearchSessions: BoundedMap<string, string>;
	cxFileChangeSnapshots: BoundedMap<string, string>;
	cxUndoStackByThread: BoundedMap<string, string[]>;
	unregisterBoundedState: Array<() => void>;
	heartbeatTimer: ReturnType<typeof setInterval> | null;
	tickTimer: ReturnType<typeof setInterval> | null;
	eventBufferPruneTimer: ReturnType<typeof setInterval> | null;
	secureServer: ReturnType<typeof Bun.serve> | null;
	securePort: number;
	loopbackServer: ReturnType<typeof Bun.serve> | null;
	loopbackPort: number | null;
};

export type CreateBridgeStateParams = {
	opencode: OpenCodeConnector | null;
	auth: AuthTokenState;
	webDistDir: string;
	defaultAgent: AgentType;
	logInfo: (message: string) => void;
};

export function createBridgeState(params: CreateBridgeStateParams): BridgeState {
	const compiled = isCompiledBinary();

	const registerState = <K, V>(name: string, map: BoundedMap<K, V>): (() => void) =>
		registerSweepable({
			name,
			sweep: (now) => map.sweep(now),
			size: () => map.size,
			limit: () => map.stats().maxEntries,
		});

	// Per-session bookkeeping a daemon accumulates over weeks. Every entry is looked up whenever its
	// session is used, so a cap plus a sweep only ever drops sessions nobody touched in a long time.
	const SESSION_STATE_MAX_ENTRIES = 2000;
	const UNDO_STATE_TTL_MS = 24 * 60 * 60 * 1000;

	const ocSessionProjectPaths = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const ccSessionCwds = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxActiveTurns = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxThreadCwds = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxThreadNames = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxSearchSessions = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxFileChangeSnapshots = new BoundedMap<string, string>({
		maxEntries: 5000,
		ttlMs: UNDO_STATE_TTL_MS,
	});
	const cxUndoStackByThread = new BoundedMap<string, string[]>({
		maxEntries: 500,
		ttlMs: UNDO_STATE_TTL_MS,
	});

	const unregisterBoundedState = [
		registerState("oc-session-project-paths", ocSessionProjectPaths),
		registerState("cc-session-cwds", ccSessionCwds),
		registerState("cx-active-turns", cxActiveTurns),
		registerState("cx-thread-cwds", cxThreadCwds),
		registerState("cx-thread-names", cxThreadNames),
		registerState("cx-search-sessions", cxSearchSessions),
		registerState("cx-file-change-snapshots", cxFileChangeSnapshots),
		registerState("cx-undo-stacks", cxUndoStackByThread),
	];

	const sockets = new Set<ServerWebSocket<unknown>>();
	const contexts = new Map<ServerWebSocket<unknown>, ConnectionContext>();

	const runtimeSendQueue = new RuntimeSendQueue(
		(ws) => {
			const ctx = contexts.get(ws);
			if (!ctx) return undefined;
			return { lastRttMs: ctx.lastRttMs, connectionType: ctx.connectionType };
		},
		{
			// A socket that dropped a frame or fell too far behind is not reading: close it so the
			// app reconnects and resyncs through set_view + lastRuntimeSeq.
			onDeadSocket: (ws, reason) => {
				params.logInfo(`[WS] Shedding socket (${reason})`);
				try {
					ws.close(1013, "backpressure");
				} catch {
					// already gone
				}
			},
		},
	);

	return {
		sockets,
		contexts,
		compiled,
		webDistDir: params.webDistDir,
		tlsEnabled: compiled ? true : isTlsEnabledByEnv(),
		allowTokenInUrl: !compiled && process.env.BROSKI_ALLOW_TOKEN_IN_URL === "1",
		tlsMaterial: null,
		authState: params.auth,
		authToken: params.auth.token,
		authExpiresAt: params.auth.expiresAt,
		currentAgent: params.defaultAgent,
		codexClient: null,
		ptyManager: new PtyManager(params.opencode),
		runtimeSendQueue,
		piDurableSockets: new PiDurableSocketPool(runtimeSendQueue),
		sessionWatchers: new Map(),
		ccExternalTails: new Map(),
		cxExternalTails: new Map(),
		ocExternalTails: new Map(),
		ccPermissionWaiters: new Map(),
		ccElicitationWaiters: new Map(),
		cxApprovalWaiters: new Map(),
		ccSessionOwners: new Map(),
		cxThreadOwners: new Map(),
		ocSessionOwners: new Map(),
		cxItemCache: new Map(),
		ccEventBuffers: new Map(),
		cxEventBuffers: new Map(),
		recentChatMessageIds: new Map(),
		lastGitBranchByProject: new Map(),
		ocSessionProjectPaths,
		ccSessionCwds,
		cxActiveTurns,
		cxThreadCwds,
		cxThreadNames,
		cxSearchSessions,
		cxFileChangeSnapshots,
		cxUndoStackByThread,
		unregisterBoundedState,
		heartbeatTimer: null,
		tickTimer: null,
		eventBufferPruneTimer: null,
		secureServer: null,
		securePort: 0,
		loopbackServer: null,
		loopbackPort: null,
	};
}
