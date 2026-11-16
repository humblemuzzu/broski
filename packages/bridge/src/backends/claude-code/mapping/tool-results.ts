/**
 * A `tool_result` block and its structured `tool_use_result` as a contract tool result. The store maps history with it
 * and the terminal tail its lines, so a result reads the same live, in the transcript and in a terminal's session.
 */

import { MAX_TEXT_CHARS, type ToolContent, type ToolOutcome, type ToolResult } from "../../../contract";
import { clip } from "../bounds";
import { isRecord } from "../json";
import { fileChangesOf } from "./file-changes";
import { toolDisplay } from "./tool-displays";
import { failureOutcome } from "./tool-outcome";
import { contentParts, structuredText } from "./tool-text";

export interface ToolResultMapping {
	readonly outcome: ToolOutcome;
	readonly result: ToolResult;
}

/** Where the result sits, for the ids of its images (`ids.ts` `imageAttachmentId`). */
export interface ResultPlace {
	readonly entryUuid: string;
	readonly blockIndex: number;
}

const FAILED_WITHOUT_TEXT = "The tool call failed";

function textOf(parts: readonly ToolContent[]): string {
	return parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n");
}

/**
 * `block` is the `tool_result` block, `toolUseResult` the frame's structured output (only meaningful when the frame
 * holds this one result). A result the CLI marked `is_error` reports its text as `error` and no file changes;
 * `failureOutcome` reads its wording for `aborted` and `denied`. Bash reports no exit code, so `exitCode` is never set.
 */
export function toolResultOf(
	block: unknown,
	toolUseResult: unknown,
	place: ResultPlace,
	toolName: string | undefined,
): ToolResultMapping {
	const record = isRecord(block) ? block : {};
	const parts = contentParts(record.content, place.entryUuid, place.blockIndex);
	if (record.is_error === true) return failedResult(parts);
	const structured = structuredText(toolName, toolUseResult);
	const hasImage = parts.some((part) => part.kind === "image_ref");
	const content: ToolContent[] =
		structured !== undefined && structured !== "" && !hasImage
			? contentParts(structured, place.entryUuid, place.blockIndex)
			: parts;
	const display = toolName === undefined ? undefined : toolDisplay(toolName, toolUseResult);
	return {
		outcome: "completed",
		result: {
			content,
			fileChanges: toolName === undefined ? [] : fileChangesOf(toolName, undefined, toolUseResult),
			...(display !== undefined && { display }),
		},
	};
}

function failedResult(parts: readonly ToolContent[]): ToolResultMapping {
	const text = textOf(parts);
	const outcome = failureOutcome(text);
	return {
		outcome,
		result: {
			content: parts.filter((part) => part.kind === "image_ref"),
			fileChanges: [],
			...(outcome !== "aborted" && { error: clip(text === "" ? FAILED_WITHOUT_TEXT : text, MAX_TEXT_CHARS) }),
		},
	};
}
