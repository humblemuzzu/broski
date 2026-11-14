/** `FrameMapper.settle`: nothing is open at rest (D22). */

import type { ToolResult } from "../../../contract";
import type { MappedEvent } from "../ports/mapping";
import { finishAllBlocks } from "./blocks";
import { endCompaction } from "./compaction";
import type { MapperState } from "./state";
import { endTool } from "./tool-calls";

const NO_RESULT = "The tool call ended without a result";

/** A tool still open when its run ends was cut short (`aborted`) or never answered (`failed`). */
function endOpenTools(state: MapperState, outcome: "completed" | "aborted"): MappedEvent[] {
	const result: ToolResult = {
		content: [],
		fileChanges: [],
		...(outcome === "completed" && { error: NO_RESULT }),
	};
	return [...state.openTools.keys()].flatMap((id) =>
		endTool(state, id, outcome === "aborted" ? "aborted" : "failed", result),
	);
}

/** Open blocks end with their text so far, then tools, a retry still scheduled, and a compaction under way. */
export function settleEvents(state: MapperState, outcome: "completed" | "aborted"): MappedEvent[] {
	const events = [...finishAllBlocks(state), ...endOpenTools(state, outcome)];
	if (state.retrying) {
		state.retrying = false;
		events.push({ event: { type: "retry_finished", succeeded: false } });
	}
	events.push(...endCompaction(state, outcome));
	state.streaming = undefined;
	state.turnUnderway = false;
	return events;
}
