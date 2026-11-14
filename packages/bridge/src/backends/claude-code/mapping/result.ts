/** What a turn's `result` shows: the totals so far and the end of anything still open. Its outcome is the host's. */

import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import { endCompaction } from "./compaction";
import { turnOutcome } from "./outcome";
import type { MapperState } from "./state";
import { usageOf } from "./usage";

/**
 * `result.result` is the turn's final text, which the blocks already showed, so it is never shown again. A run goes on
 * past a result (queued input, a background task's wake-up turn): `run_finished` is `idle`, not this.
 */
export function resultEvents(state: MapperState, frame: SDKResultMessage): MappedEvent[] {
	state.turnUnderway = false;
	const compaction = endCompaction(state, turnOutcome(frame).kind === "aborted" ? "aborted" : "completed");
	const usage = usageOf(frame, state.model);
	return [...compaction, ...(usage === undefined ? [] : [{ event: { type: "usage_updated" as const, usage } }])];
}
