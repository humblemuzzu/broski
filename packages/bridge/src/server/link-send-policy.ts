/**
 * The send policy of a broski-link socket, which differs from a network socket's in one way that
 * matters: nobody kills the connection because the daemon is slow. Its peer holds the phone's
 * window, so the bridge gives it a wider one of its own and closes it only for real overflow.
 */

import type { ServerWebSocket } from "bun";
import {
	LINK_OVERFLOW_CLOSE_CODE,
	LINK_OVERFLOW_CLOSE_REASON,
	NETWORK_SEND_LIMITS,
	type SendLimits,
} from "../transport/send-limits";
import type { BridgeLimits } from "./limits";
import { isLinkDaemonSocketData, isLinkSocketData } from "./link-identity";

export function isLinkTransportSocket(data: unknown): boolean {
	return isLinkSocketData(data) || isLinkDaemonSocketData(data);
}

export function linkSendLimits(limits: BridgeLimits): SendLimits {
	return {
		kind: "link",
		maxPendingBytes: limits.linkBackpressureLimitBytes,
		maxPendingFrames: framesForBytes(limits.linkBackpressureLimitBytes),
		maxMessageBytes: limits.linkMessageLimitBytes,
	};
}

/** The network frame cap is linear in its byte cap, so the link frame cap scales the same way. */
function framesForBytes(maxPendingBytes: number): number {
	const scale = maxPendingBytes / NETWORK_SEND_LIMITS.maxPendingBytes;
	return Math.ceil(scale * NETWORK_SEND_LIMITS.maxPendingFrames);
}

/**
 * Bun closes a socket itself when `closeOnBackpressureLimit` fires, with a code of its own choosing.
 * A link socket must only ever see {@link LINK_OVERFLOW_CLOSE_CODE}, so Bun's guard is left off and
 * the send queue, which can see both the held frames and `getBufferedAmount()`, closes it instead.
 */
export function linkBackpressureConfig(limits: BridgeLimits): {
	backpressureLimit: number;
	closeOnBackpressureLimit: boolean;
} {
	return { backpressureLimit: limits.linkBackpressureLimitBytes, closeOnBackpressureLimit: false };
}

export function closeLinkOverflow(ws: ServerWebSocket<unknown>): void {
	try {
		ws.close(LINK_OVERFLOW_CLOSE_CODE, LINK_OVERFLOW_CLOSE_REASON);
	} catch {
		// already gone
	}
}

/** 1013 on a network socket: the app reconnects and resyncs. */
export function closeNetworkBackpressure(ws: ServerWebSocket<unknown>): void {
	try {
		ws.close(1013, "backpressure");
	} catch {
		// already gone
	}
}
