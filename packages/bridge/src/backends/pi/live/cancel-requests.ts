/**
 * Stopping a compaction or a retry on its own, as the terminal's Esc does while its status line shows one
 * (pi `dist/modes/interactive/interactive-mode.js:2937, 2999`). `abort()` would end the run too
 * (`dist/core/agent-session.js:1975-1976`). Neither takes the session lock: like Stop, they must reach Pi while a prompt waits.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ActionResult, SessionSnapshot } from "../../../contract";
import { ACCEPTED, rejected } from "../rejections";

export function cancelCompaction(session: AgentSession): ActionResult {
	session.abortCompaction();
	return ACCEPTED;
}

/** `isRetrying` is true only while Pi waits out the delay (`dist/core/agent-session.js:3133`); the attempt after it is the run. */
export function cancelRetry(session: AgentSession, snapshot: SessionSnapshot): ActionResult {
	if (session.isRetrying) {
		session.abortRetry();
		return ACCEPTED;
	}
	return snapshot.retry === undefined
		? ACCEPTED
		: rejected("stale", "the next attempt has already started; Stop ends it");
}
