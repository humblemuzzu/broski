/**
 * Pi tool calls and results as contract values: `tool_started/updated/finished` live, `ToolResult` for
 * the live stream and the transcript alike, and the file changes built-in tools report.
 */

import type { ImageContent, TextContent, ToolCall } from "@earendil-works/pi-ai";
import {
	type FileChange,
	type ImageRef,
	type JsonValue,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
	type MessageId,
	type ToolContent,
	type ToolFinishedEvent,
	type ToolOutcome,
	type ToolResult,
	type ToolStartedEvent,
	type ToolUpdatedEvent,
} from "../../../contract";
import { clipEnd, clipStart } from "../bounds";
import type { ToolCallIds } from "../ids";
import { boundedJson } from "../json";
import { phoneText } from "../phone-text";
import type { PiEvent } from "../ports";
import { withoutTerminalEscapes } from "../terminal-text";

/** A model can send a call with no name; `ToolStartedEvent.name` and `ToolCallItem.name` need one. */
const UNNAMED_TOOL = "unnamed";

/** What a call's outcome depends on beyond Pi's `isError` (D14, D17). */
export interface OutcomeFacts {
	readonly isError: boolean;
	/** The permission gate blocked this call. */
	readonly denied: boolean;
	/** The run was aborted while this call ran. */
	readonly aborted: boolean;
}

export function toolOutcome(facts: OutcomeFacts): ToolOutcome {
	if (facts.denied) return "denied";
	if (facts.aborted) return "aborted";
	return facts.isError ? "failed" : "completed";
}

export function toolNameOf(name: string): string {
	return clipStart(name, MAX_NAME_CHARS) || UNNAMED_TOOL;
}

/** A call the assistant message streams (`toolcall_start`): input absent until `toolcall_end`. */
export function toolStartedOfCall(
	call: Pick<ToolCall, "id" | "name">,
	messageId: MessageId,
	tools: ToolCallIds,
): ToolStartedEvent {
	return { type: "tool_started", toolCallId: tools.liveId(call.id), name: toolNameOf(call.name), messageId };
}

/** A call no message streamed: a nested one (`parentToolCallId`), started at `tool_execution_start`. */
export function toolStartedOfExecution(event: PiEvent<"tool_execution_start">, tools: ToolCallIds): ToolStartedEvent {
	const parent = event.parentToolCallId === undefined ? undefined : tools.find(event.parentToolCallId);
	return {
		type: "tool_started",
		toolCallId: tools.liveId(event.toolCallId),
		name: toolNameOf(event.toolName),
		input: boundedJson(event.args),
		...(parent !== undefined && { parentToolCallId: parent }),
	};
}

/** `partialResult` is the output so far, whole each time: `output_replaced`, newest text kept. */
export function toolOutputOf(event: PiEvent<"tool_execution_update">, tools: ToolCallIds): ToolUpdatedEvent {
	const text = clipEnd(withoutTerminalEscapes(textOfResult(event.partialResult)), MAX_TEXT_CHARS);
	return {
		type: "tool_updated",
		toolCallId: tools.liveId(event.toolCallId),
		update: { kind: "output_replaced", text },
	};
}

/**
 * `toolcall_end` carries the arguments the tool runs with. A call whose arguments were not a JSON
 * object arrives with `arguments: {}` and an `argumentsError`; Pi then fails the call itself at
 * validation (pi-ai `src/utils/validation.ts:318-319`), so the failure reaches the phone as that call's
 * error result, which quotes what the model sent.
 */
export function toolInputOf(call: Pick<ToolCall, "id" | "arguments">, tools: ToolCallIds): ToolUpdatedEvent {
	return {
		type: "tool_updated",
		toolCallId: tools.liveId(call.id),
		update: { kind: "input", input: boundedJson(call.arguments) },
	};
}

/**
 * Text and images of a result. A failed result's text is the error (Pi has no other field for it), so it
 * goes to `error` and not twice into `content`; a failed call changed nothing, so it reports no file
 * changes. An image `imageRef` cannot name (a nested call has no entry to read it from) becomes a
 * placeholder, never inline bytes. A tool written in JavaScript can return no `content`: Pi fills it in
 * for the stored message, not for `tool_execution_end.result` (pi-agent-core `src/agent-loop.ts:945-947`).
 */
export function toolResultOf(
	content: readonly (TextContent | ImageContent)[] | null | undefined,
	isError: boolean,
	fileChanges: readonly FileChange[],
	imageRef: (contentIndex: number) => ImageRef | undefined,
): ToolResult {
	const parts: ToolContent[] = [];
	const errors: string[] = [];
	(content ?? []).slice(0, MAX_LIST_ITEMS).forEach((block, index) => {
		if (block.type === "image") {
			parts.push(imageRef(index) ?? { kind: "text", text: `[${clipStart(block.mimeType, MAX_NAME_CHARS)} image]` });
			return;
		}
		if (typeof block.text !== "string") return;
		const text = phoneText(block.text);
		if (text === "") return;
		if (isError) errors.push(text);
		else parts.push({ kind: "text", text });
	});
	return {
		content: parts,
		fileChanges: isError ? [] : fileChanges.slice(0, MAX_LIST_ITEMS),
		...(errors.length > 0 && { error: clipStart(errors.join("\n"), MAX_TEXT_CHARS) }),
	};
}

export function toolFinished(
	piToolCallId: string,
	outcome: ToolOutcome,
	result: ToolResult,
	tools: ToolCallIds,
): ToolFinishedEvent {
	return { type: "tool_finished", toolCallId: tools.liveId(piToolCallId), outcome, result };
}

/**
 * What a built-in tool changed on disk: `edit`'s unified `details.patch` (not `details.diff`, which is
 * drawn for a terminal), `write`'s path. `write` reports no details, so a new file cannot be told from an
 * overwritten one: both are `modified`.
 */
export function fileChangesOf(toolName: string, input: JsonValue, details: JsonValue | undefined): FileChange[] {
	switch (toolName) {
		case "edit":
			return editChanges(input, details);
		case "write":
			return writeChanges(input);
		default:
			return [];
	}
}

function editChanges(input: JsonValue, details: JsonValue | undefined): FileChange[] {
	const patch = fieldOf(details, "patch");
	if (typeof patch !== "string") return [];
	const path = nonEmpty(fieldOf(input, "path")) ?? patchPath(patch);
	if (path === undefined) return [];
	return [
		{
			path: clipStart(path, MAX_PATH_CHARS),
			change: "modified",
			diff: clipStart(patch, MAX_TEXT_CHARS),
			...patchLines(patch),
		},
	];
}

function writeChanges(input: JsonValue): FileChange[] {
	const path = nonEmpty(fieldOf(input, "path"));
	return path === undefined ? [] : [{ path: clipStart(path, MAX_PATH_CHARS), change: "modified" }];
}

/** The path Pi's patch names, for a result read back from a session file, which holds no call input. */
function patchPath(patch: string): string | undefined {
	const [oldLine, newLine] = patch.split("\n", 2);
	if (!oldLine?.startsWith("--- ") || !newLine?.startsWith("+++ ")) return undefined;
	return nonEmpty(newLine.slice("+++ ".length));
}

/** Lines added and removed inside the hunks; the two header lines before the first `@@` are not counted. */
function patchLines(patch: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	let inHunk = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("@@")) inHunk = true;
		else if (inHunk && line.startsWith("+")) additions += 1;
		else if (inHunk && line.startsWith("-")) deletions += 1;
	}
	return { additions, deletions };
}

function fieldOf(value: JsonValue | undefined, key: string): JsonValue | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	return Object.hasOwn(value, key) ? value[key] : undefined;
}

function nonEmpty(value: JsonValue | undefined): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

/** `partialResult` is typed `any` in Pi's events; only text blocks of a `content` list count. */
function textOfResult(result: unknown): string {
	if (typeof result !== "object" || result === null || !("content" in result) || !Array.isArray(result.content)) {
		return "";
	}
	const texts: string[] = [];
	for (const block of result.content) {
		if (typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string") {
			texts.push(block.text);
		}
	}
	return texts.join("\n");
}
