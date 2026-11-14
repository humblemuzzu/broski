import type { ServerWebSocket } from "bun";
import type { AuthTokenState } from "../auth-token";
import { isCompiledBinary } from "../platform";
import { isTlsEnabledByEnv, type TlsMaterial } from "../tls";
import { NETWORK_SEND_LIMITS } from "../transport/send-limits";
import { SendQueue } from "../transport/send-queue";
import type { BridgeLimits } from "./limits";
import type { LinkIngress } from "./link-ingress";
import { closeLinkOverflow, closeNetworkBackpressure, isLinkTransportSocket, linkSendLimits } from "./link-send-policy";

/**
 * Everything the sections of the bridge server share over the daemon's lifetime. Built once by
 * `createBridgeServer` and handed to each section factory so no section owns another's state.
 */
export type BridgeState = {
	/** The client sockets: the daemon's device sockets and the loopback listener's. The feed and the proxy are not clients. */
	sockets: Set<ServerWebSocket<unknown>>;
	compiled: boolean;
	tlsEnabled: boolean;
	allowTokenInUrl: boolean;
	tlsMaterial: TlsMaterial | null;
	authToken: string;
	sendQueue: SendQueue;
	sweepTimer: ReturnType<typeof setInterval> | null;
	secureServer: ReturnType<typeof Bun.serve> | null;
	securePort: number;
	linkIngress: LinkIngress | null;
};

export type CreateBridgeStateParams = {
	auth: AuthTokenState;
	limits: BridgeLimits;
	logInfo: (message: string) => void;
};

/** The one scheduler every frame a client sees goes through. */
function createSendQueue(params: CreateBridgeStateParams): SendQueue {
	const linkLimits = linkSendLimits(params.limits);
	return new SendQueue({
		limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
		onTooLarge: (_ws, detail) => {
			params.logInfo(`[Link] frame too large for the link: bytes=${detail.bytes} limit=${detail.limit}`);
		},
		// A socket that dropped a frame or fell too far behind is not reading. A client on the network
		// reconnects and reattaches with its last `{epoch, seq}`; a link socket's peer is the daemon,
		// which redials, so it gets its own close code.
		onDeadSocket: (ws, reason, detail) => {
			if (isLinkTransportSocket(ws.data)) {
				params.logInfo(`[Link] Closing link socket (${reason})${detail ? ` ${detail}` : ""}`);
				closeLinkOverflow(ws);
				return;
			}
			params.logInfo(`[WS] Shedding socket (${reason})`);
			closeNetworkBackpressure(ws);
		},
	});
}

export function createBridgeState(params: CreateBridgeStateParams): BridgeState {
	const compiled = isCompiledBinary();
	return {
		sockets: new Set(),
		compiled,
		tlsEnabled: compiled ? true : isTlsEnabledByEnv(),
		allowTokenInUrl: !compiled && process.env.BROSKI_ALLOW_TOKEN_IN_URL === "1",
		tlsMaterial: null,
		authToken: params.auth.token,
		sendQueue: createSendQueue(params),
		sweepTimer: null,
		secureServer: null,
		securePort: 0,
		linkIngress: null,
	};
}
