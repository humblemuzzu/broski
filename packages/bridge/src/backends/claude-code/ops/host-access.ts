/** Reaching a session's host from an op: an unknown session is `not_found` whichever way the op reaches it. */

import type { Rejected, SessionId } from "../../../contract";
import type { HostView, OpsDeps } from "../ports";

/** `work` with the session's host, or `undefined` when nobody hosts it; with no `sessionId`, always `undefined`. */
export async function withOptionalHost<T>(
	deps: OpsDeps,
	sessionId: SessionId | undefined,
	work: (host: HostView | undefined) => Promise<T>,
): Promise<T | Rejected> {
	if (sessionId === undefined) return work(undefined);
	return deps.live.withLiveHost(sessionId, work);
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
