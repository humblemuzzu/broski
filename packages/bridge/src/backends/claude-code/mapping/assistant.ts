/** Lane B · `assistant` frames (one block each, PLAN fact 7): `block_finished`, `tool_started`, an aborted block. */

import type { SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function assistantEvents(_state: MapperState, _frame: SDKAssistantMessage): MappedEvent[] {
	return [];
}
