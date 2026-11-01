/**
 * Lane B · a `tool_result` block and its structured `tool_use_result` as a contract tool result. Shared: lane A maps
 * history with it, lane G the tail, so a result reads the same live and in the transcript.
 */

import type { ToolOutcome, ToolResult } from "../../../contract";

export interface ToolResultMapping {
	readonly outcome: ToolOutcome;
	readonly result: ToolResult;
}

/** Where the result sits, for the ids of its images (`ids.ts` `imageAttachmentId`). */
export interface ResultPlace {
	readonly entryUuid: string;
	readonly blockIndex: number;
}

export function toolResultOf(
	_block: unknown,
	_toolUseResult: unknown,
	_place: ResultPlace,
	_toolName: string | undefined,
): ToolResultMapping {
	return { outcome: "failed", result: { content: [], fileChanges: [], error: "not built yet: lane B toolResultOf" } };
}
