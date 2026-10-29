import type { SessionSnapshot } from "../contract";

/** How long a session nobody views stays open once idle, so a phone that comes back soon finds it warm. */
export const DEFAULT_IDLE_CLOSE_MS = 60_000;

/**
 * Whether the session has work in flight, which keeps its `OpenSession` open with or without
 * viewers (contract README §5, rule 3): a run, an ask waiting for a human, a compaction or retry
 * under way, or accepted input still queued. Closing then would raise asks to nobody and lose
 * events from the log.
 */
export function holdsOpen(snapshot: SessionSnapshot): boolean {
	return (
		snapshot.run !== undefined ||
		snapshot.interactions.length > 0 ||
		snapshot.compaction !== undefined ||
		snapshot.retry !== undefined ||
		snapshot.queue.length > 0
	);
}
