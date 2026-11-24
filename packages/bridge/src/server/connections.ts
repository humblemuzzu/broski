import type { ServerWebSocket } from "bun";
import type { ContractSeam } from "./contract-seam";
import type { BridgeLimits } from "./limits";
import { attachLinkFeed, detachLinkFeed, handleLinkFeedMessage } from "./link-feed/feed";
import { isLinkDaemonSocketData } from "./link-identity";
import type { LeveledLogger } from "./logger";
import type { BridgeState } from "./state";

type RateBucket = { tokens: number; lastRefill: number; blockedUntil: number };

export type Connections = {
	websocketConfig: Bun.WebSocketHandler<unknown>;
};

export type ConnectionsDeps = {
	state: BridgeState;
	log: LeveledLogger;
	limits: BridgeLimits;
	contract: ContractSeam;
};

function closeQuietly(socket: { close: (code?: number, reason?: string) => void }, code?: number, reason?: string) {
	try {
		socket.close(code, reason);
	} catch {
		// already closed
	}
}

/**
 * The bridge's WebSocket handler, shared by the link ingress and the loopback listener. Two kinds of socket
 * reach it: the daemon's feed (`link-feed/`) and a client, whose every frame goes to the bridge core through the
 * seam under a per-socket rate limit.
 */
export function createConnections(deps: ConnectionsDeps): Connections {
	const { state } = deps;
	const rateLimiters = new Map<ServerWebSocket<unknown>, RateBucket>();

	const withinRateLimit = (ws: ServerWebSocket<unknown>): boolean => {
		const now = Date.now();
		const rate = deps.limits.rate;
		const bucket = rateLimiters.get(ws) ?? { tokens: rate.burst, lastRefill: now, blockedUntil: 0 };
		rateLimiters.set(ws, bucket);
		if (bucket.blockedUntil && now < bucket.blockedUntil) return false;
		const elapsedSec = (now - bucket.lastRefill) / 1000;
		bucket.tokens = Math.min(rate.burst, bucket.tokens + elapsedSec * rate.perSecond);
		bucket.lastRefill = now;
		if (bucket.tokens < 1) {
			bucket.blockedUntil = now + rate.blockMs;
			return false;
		}
		bucket.tokens -= 1;
		return true;
	};

	const websocketConfig = {
		// A client that stops reading (backgrounded, dead radio) must not grow the bridge: past
		// 4 MiB buffered it is closed and it reconnects and reattaches.
		backpressureLimit: deps.limits.wsBackpressureLimitBytes,
		closeOnBackpressureLimit: true,
		maxPayloadLength: deps.limits.maxWsMessageBytes,
		idleTimeout: deps.limits.wsIdleTimeoutSeconds,
		// `BROSKI_WS_DEFLATE=0` turns it off for a client whose compression is broken.
		perMessageDeflate: process.env.BROSKI_WS_DEFLATE !== "0",
		open(ws: ServerWebSocket<unknown>) {
			if (isLinkDaemonSocketData(ws.data)) {
				attachLinkFeed(ws, deps.log.logInfo);
				return;
			}
			state.sockets.add(ws);
			deps.log.logUser(`Client connected (${state.sockets.size} active)`);
		},
		close(ws: ServerWebSocket<unknown>, code?: number, reason?: string) {
			if (isLinkDaemonSocketData(ws.data)) {
				detachLinkFeed(ws);
				return;
			}
			deps.contract.disconnect(ws);
			state.sockets.delete(ws);
			rateLimiters.delete(ws);
			state.sendQueue.disposeSocket(ws);
			deps.log.logUser(`Client disconnected (${state.sockets.size} active)`);
			deps.log.logInfo(`[WS] Client disconnected: code=${code}, reason=${reason}`);
		},
		message(ws: ServerWebSocket<unknown>, raw: string | Uint8Array) {
			if (isLinkDaemonSocketData(ws.data)) {
				handleLinkFeedMessage(ws, raw);
				return;
			}
			const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
			if (bytes > deps.limits.maxWsMessageBytes) {
				closeQuietly(ws, 1009, "Message too large");
				return;
			}
			if (!withinRateLimit(ws)) {
				deps.contract.refuse(ws, raw);
				return;
			}
			void deps.contract.receive(ws, raw);
		},
		drain(ws: ServerWebSocket<unknown>) {
			state.sendQueue.onDrain(ws);
		},
	} satisfies Bun.WebSocketHandler<unknown>;

	return { websocketConfig };
}
