/** Lane B · `user` frames: tool results (`tool_finished`), and prompts this host did not send (`user_message`). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function userEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
