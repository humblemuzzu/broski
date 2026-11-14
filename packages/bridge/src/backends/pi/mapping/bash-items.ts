/**
 * A command the person ran in Pi's terminal with `!` or `!!`, read back from the `bashExecution` message Pi recorded,
 * as the contract's `bash` tool call.
 */

import {
	type JsonValue,
	MAX_TEXT_CHARS,
	type ToolOutcome,
	type ToolResult,
	type TranscriptItem,
} from "../../../contract";
import { clipStart } from "../bounds";
import { entryItemId, storedToolCallId } from "../ids";
import { boundedJson } from "../json";
import { phoneText } from "../phone-text";

/** The parts of Pi's `BashExecutionMessage` (pi-coding-agent `src/core/messages.ts`) a card shows. */
export interface BashRecord {
	readonly command: string;
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
	readonly excludeFromContext?: boolean;
}

const BASH_TOOL_NAME = "bash";

function bashInput(command: string, excludeFromContext: boolean | undefined): JsonValue {
	return boundedJson({ command, ...(excludeFromContext === true && { excludeFromContext: true }) });
}

/** Cancelled is `aborted`; an exit code other than 0 is `failed`, with the output kept as output. */
function bashOutcome(record: Pick<BashRecord, "cancelled" | "exitCode">): ToolOutcome {
	if (record.cancelled) return "aborted";
	return typeof record.exitCode === "number" && record.exitCode !== 0 ? "failed" : "completed";
}

function bashResult(record: BashRecord): ToolResult {
	const lines = [record.output];
	if (record.truncated && record.fullOutputPath)
		lines.push(`[Output truncated. Full output: ${record.fullOutputPath}]`);
	const text = phoneText(lines.join("\n"));
	const failed = bashOutcome(record) === "failed";
	return {
		content: text === "" ? [] : [{ kind: "text", text: clipStart(text, MAX_TEXT_CHARS) }],
		fileChanges: [],
		...(failed && { error: `Command exited with code ${record.exitCode}` }),
		...(typeof record.exitCode === "number" && Number.isInteger(record.exitCode) && { exitCode: record.exitCode }),
	};
}

export function bashItems(entryId: string, record: BashRecord, stamp: { at?: number }): TranscriptItem[] {
	const toolCallId = storedToolCallId(entryId, 0);
	return [
		{
			kind: "tool_call",
			id: entryItemId(entryId, 0),
			...stamp,
			toolCallId,
			name: BASH_TOOL_NAME,
			input: bashInput(record.command, record.excludeFromContext),
		},
		{
			kind: "tool_result",
			id: entryItemId(entryId, 1),
			...stamp,
			toolCallId,
			outcome: bashOutcome(record),
			result: bashResult(record),
		},
	];
}
