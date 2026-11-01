/** Lane B · `conversation_reset` (`/clear`, leaving plan mode with a cleared context) as `session_replaced`. */

import type { SDKConversationResetMessage } from "@anthropic-ai/claude-agent-sdk";
import { fitsId } from "../bounds";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

/**
 * The live session goes on as `new_conversation_id`; the old one keeps its history. Nothing said before the reset can
 * be retracted after it, so the frames the mapper remembers for retraction go. The host starts the new session's
 * mapper (its child sessions are `<new id>/<agent id>`).
 */
export function resetEvents(state: MapperState, frame: SDKConversationResetMessage): MappedEvent[] {
	const sessionId = frame.new_conversation_id;
	if (!fitsId(sessionId)) return [];
	state.frameMessages.clear();
	return [
		{
			event: {
				type: "session_replaced",
				session: { backend: "claude-code", sessionId },
			},
		},
	];
}
