import type { PiStreamMessage } from "../types/pi";

const STATE_CHANGING_EVENTS = new Set<PiStreamMessage["type"]>([
	"agent-start",
	"agent-end",
	"agent-settled",
	"error",
	"thinking-level-changed",
	"session-info-changed",
]);

export function isPiStateChangingEvent(message: PiStreamMessage): boolean {
	return STATE_CHANGING_EVENTS.has(message.type);
}
