/** Lane B · `status: compacting` and `compact_boundary` as `compaction_started`/`compaction_finished` (Q13). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

export function compactionEvents(_state: MapperState, _frame: SDKMessage): MappedEvent[] {
	return [];
}
