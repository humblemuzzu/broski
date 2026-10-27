import type { PiStreamMessage } from "../types/pi";

/**
 * `agent-end` is not one of them: the session still reports itself streaming then, and a snapshot saying so
 * right after the finish event would start the turn again in the app until `agent-settled` corrects it.
 */
const STATE_CHANGING_EVENTS = new Set<PiStreamMessage["type"]>([
	"agent-start",
	"agent-settled",
	"error",
	"thinking-level-changed",
	"session-info-changed",
]);

export function isPiStateChangingEvent(message: PiStreamMessage): boolean {
	return STATE_CHANGING_EVENTS.has(message.type);
}
