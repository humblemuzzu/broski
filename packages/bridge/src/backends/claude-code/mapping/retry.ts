/** Lane B · `system/api_retry` as `retry_scheduled`; `retry_finished` from the next frame of the turn (Q13). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function retryEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
