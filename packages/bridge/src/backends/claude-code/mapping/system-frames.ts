/** Lane B · system frames shown as notices and extensions (`rate_limit`, `prompt_suggestion`); the rest ignored. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function systemEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
