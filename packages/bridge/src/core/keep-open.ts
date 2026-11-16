import type { SessionSnapshot } from "../contract";

/** How long a session nobody views stays open once idle, so a phone that comes back soon finds it warm. */
export const DEFAULT_IDLE_CLOSE_MS = 60_000;

/**
 * Whether the session has work in flight, which keeps its `OpenSession` open with or without
 * viewers (contract README §5, rule 3): a run, an ask waiting for a human, a compaction or retry
 * under way, accepted input still queued, or a task running in the background. Closing then would
 * raise asks to nobody, lose events from the log, and end the agent's process with its tasks in it.
 */
export function holdsOpen(snapshot: SessionSnapshot): boolean {
	return (
		snapshot.run !== undefined ||
		snapshot.interactions.length > 0 ||
		snapshot.compaction !== undefined ||
		snapshot.retry !== undefined ||
		snapshot.queue.length > 0 ||
		snapshot.backgroundTasks.length > 0
	);
}
