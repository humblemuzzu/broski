/** Lane B · `stream_event` frames: `block_started`/`block_delta`, and `tool_updated{input}` from `input_json_delta`. */

import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function streamEvents(_state: MapperState, _frame: SDKPartialAssistantMessage): MappedEvent[] {
	return [];
}
