import { isLinkDaemonSocketData } from "./link-identity";

export const HEARTBEAT_DEAD_AFTER_MS = 90_000;
const STALE_PING_MS = 30_000;

export type HeartbeatAction = "skip" | "close" | "wait" | "ping";

type HeartbeatContext = { lastPongAt: number; pendingPing?: { sentAt: number } };

/**
 * Only the daemon's own feed is skipped: it answers `link_feed_ping`, never `pong`. A device socket
 * behind broski-link is pinged like one on the network, because `ping`/`pong` are ordinary bridge
 * frames the daemon passes through, so they measure the path the app uses and a socket whose daemon
 * wedged is closed rather than held forever.
 */
export function heartbeatAction(socketData: unknown, ctx: HeartbeatContext, now: number): HeartbeatAction {
	if (isLinkDaemonSocketData(socketData)) return "skip";
	if (now - ctx.lastPongAt > HEARTBEAT_DEAD_AFTER_MS) return "close";
	if (ctx.pendingPing && now - ctx.pendingPing.sentAt <= STALE_PING_MS) return "wait";
	return "ping";
}
