import { isLinkDaemonSocketData, isLinkSocketData } from "./link-identity";

export const HEARTBEAT_DEAD_AFTER_MS = 90_000;
const STALE_PING_MS = 30_000;

export type HeartbeatAction = "skip" | "close" | "wait" | "ping";

type HeartbeatContext = { lastPongAt: number; pendingPing?: { sentAt: number } };

/** What one heartbeat round does for one socket. */
export function heartbeatAction(socketData: unknown, ctx: HeartbeatContext, now: number): HeartbeatAction {
	// broski-link owns liveness end to end: its unix socket closes when the daemon goes, and a phone
	// that is backgrounded must keep its session (views, subscriptions) until it resumes.
	if (isLinkSocketData(socketData) || isLinkDaemonSocketData(socketData)) return "skip";
	if (now - ctx.lastPongAt > HEARTBEAT_DEAD_AFTER_MS) return "close";
	if (ctx.pendingPing && now - ctx.pendingPing.sentAt <= STALE_PING_MS) return "wait";
	return "ping";
}
