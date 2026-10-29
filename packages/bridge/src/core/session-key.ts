import type { SessionRef } from "../contract";

/** One string per session; a backend id never holds a `:`, so the first one splits it. */
export function sessionKey(ref: SessionRef): string {
	return `${ref.backend}:${ref.sessionId}`;
}

/** One string per `id` within a session, whatever characters the ids hold. */
export function sessionScopedKey(ref: SessionRef, id: string): string {
	return JSON.stringify([ref.backend, ref.sessionId, id]);
}

/** A session as a log line names it: quoted, so a client's id cannot start a line of its own. */
export function sessionLabel(ref: SessionRef): string {
	return JSON.stringify(sessionKey(ref));
}
