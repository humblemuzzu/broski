/** Lane B · a `tool_use` block as `tool_started`, with its title, a subagent's `child_session` (D20), progress. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function toolCallEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
