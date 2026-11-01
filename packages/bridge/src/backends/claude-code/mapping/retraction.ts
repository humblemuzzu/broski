/** Lane B · `retracted_message_uuids` and `supersedes` as `messages_retracted` (fact 10). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function retractionEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
