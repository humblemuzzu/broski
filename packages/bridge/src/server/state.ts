import type { ServerWebSocket } from "bun";
import type { AuthTokenState } from "../auth-token";
import type { ClaudeElicitationReply } from "../handlers/cc_elicitation";
import { isCompiledBinary } from "../platform";
import { PtyManager } from "../pty/manager";
import type { ConnectionContext } from "../routing/types";
import { BoundedMap, registerSweepable } from "../state/bounded-map";
import { isTlsEnabledByEnv, type TlsMaterial } from "../tls";
import { NETWORK_SEND_LIMITS } from "../transport/send-limits";
import type { AgentType } from "../types";
import { RuntimeSendQueue } from "../utils/runtime-send-queue";
import type { BridgeLimits } from "./limits";
import type { LinkIngress } from "./link-ingress";
import { closeLinkOverflow, closeNetworkBackpressure, isLinkTransportSocket, linkSendLimits } from "./link-send-policy";
import type { PermissionWaiter } from "./permission-waiter";

export type ClaudePermissionReply = {
	response: "once" | "always" | "reject";
	updatedInput?: Record<string, unknown>;
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
	tlsEnabled: boolean;
	allowTokenInUrl: boolean;
	tlsMaterial: TlsMaterial | null;
	authToken: string;
	currentAgent: AgentType;
	ptyManager: PtyManager;
	runtimeSendQueue: RuntimeSendQueue;
	sessionWatchers: Map<string, Set<ServerWebSocket<unknown>>>;
	ccExternalTails: Map<string, { stop: () => void }>;
	ccPermissionWaiters: Map<string, PermissionWaiter<ClaudePermissionReply>>;
	ccElicitationWaiters: Map<string, ElicitationWaiter>;
	ccSessionOwners: Map<string, ServerWebSocket<unknown>>;
	ccEventBuffers: Map<string, BufferedStreamEvent[]>;
	recentChatMessageIds: Map<string, number>;
	lastGitBranchByProject: Map<string, string>;
	ccSessionCwds: BoundedMap<string, string>;
	unregisterBoundedState: Array<() => void>;
	heartbeatTimer: ReturnType<typeof setInterval> | null;
	tickTimer: ReturnType<typeof setInterval> | null;
	eventBufferPruneTimer: ReturnType<typeof setInterval> | null;
	secureServer: ReturnType<typeof Bun.serve> | null;
	securePort: number;
	linkIngress: LinkIngress | null;
};

export type CreateBridgeStateParams = {
	auth: AuthTokenState;
	defaultAgent: AgentType;
	limits: BridgeLimits;
	logInfo: (message: string) => void;
};

type RegisterSweepable = <K, V>(name: string, map: BoundedMap<K, V>) => () => void;

/** Per-session bookkeeping a daemon accumulates over weeks; a cap plus a sweep only drops the idle. */
const SESSION_STATE_MAX_ENTRIES = 2000;
const SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1000;

type BoundedSessionState = {
	ccSessionCwds: BoundedMap<string, string>;
	unregisterBoundedState: Array<() => void>;
};

function createBoundedSessionState(registerState: RegisterSweepable): BoundedSessionState {
	const ccSessionCwds = new BoundedMap<string, string>({
		maxEntries: SESSION_STATE_MAX_ENTRIES,
		ttlMs: SESSION_STATE_TTL_MS,
	});
	return {
		ccSessionCwds,
		unregisterBoundedState: [registerState("cc-session-cwds", ccSessionCwds)],
	};
}

/** The one scheduler every reply the phone sees goes through. */
function createRuntimeSendQueue(
	params: CreateBridgeStateParams,
	contexts: Map<ServerWebSocket<unknown>, ConnectionContext>,
): RuntimeSendQueue {
	const linkLimits = linkSendLimits(params.limits);
	return new RuntimeSendQueue(
		(ws) => {
			const ctx = contexts.get(ws);
			if (!ctx) return undefined;
			return { lastRttMs: ctx.lastRttMs };
		},
		{
			limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
			onResponseTooLarge: (_ws, detail) => {
				params.logInfo(`[Link] response_too_large type=${detail.type} bytes=${detail.bytes} limit=${detail.limit}`);
			},
			// A socket that dropped a frame or fell too far behind is not reading. A phone on the
			// network reconnects and resyncs through set_view + lastRuntimeSeq; a link socket's peer
			// is the daemon, which redials and tells the phone to resync, so it gets its own code.
			onDeadSocket: (ws, reason, detail) => {
				if (isLinkTransportSocket(ws.data)) {
					params.logInfo(`[Link] Closing link socket (${reason})${detail ? ` ${detail}` : ""}`);
					closeLinkOverflow(ws);
					return;
				}
				params.logInfo(`[WS] Shedding socket (${reason})`);
				closeNetworkBackpressure(ws);
			},
		},
	);
}

/** Per-session maps and waiters: who owns a session, and what is waiting on it. */
function createSessionMaps() {
	return {
		sessionWatchers: new Map<string, Set<ServerWebSocket<unknown>>>(),
		ccExternalTails: new Map<string, { stop: () => void }>(),
		ccPermissionWaiters: new Map<string, PermissionWaiter<ClaudePermissionReply>>(),
		ccElicitationWaiters: new Map<string, ElicitationWaiter>(),
		ccSessionOwners: new Map<string, ServerWebSocket<unknown>>(),
		ccEventBuffers: new Map<string, BufferedStreamEvent[]>(),
		recentChatMessageIds: new Map<string, number>(),
		lastGitBranchByProject: new Map<string, string>(),
	};
}

export function createBridgeState(params: CreateBridgeStateParams): BridgeState {
	const compiled = isCompiledBinary();

	const registerState: RegisterSweepable = (name, map) =>
		registerSweepable({
			name,
			sweep: (now) => map.sweep(now),
			size: () => map.size,
			limit: () => map.stats().maxEntries,
		});

	const sockets = new Set<ServerWebSocket<unknown>>();
	const contexts = new Map<ServerWebSocket<unknown>, ConnectionContext>();
	const runtimeSendQueue = createRuntimeSendQueue(params, contexts);

	return {
		sockets,
		contexts,
		compiled,
		tlsEnabled: compiled ? true : isTlsEnabledByEnv(),
		allowTokenInUrl: !compiled && process.env.BROSKI_ALLOW_TOKEN_IN_URL === "1",
		tlsMaterial: null,
		authToken: params.auth.token,
		currentAgent: params.defaultAgent,
		ptyManager: new PtyManager(),
		runtimeSendQueue,
		...createSessionMaps(),
		...createBoundedSessionState(registerState),
		heartbeatTimer: null,
		tickTimer: null,
		eventBufferPruneTimer: null,
		secureServer: null,
		securePort: 0,
		linkIngress: null,
	};
}
