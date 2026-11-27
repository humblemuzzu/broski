/**
 * An agy tool call as the contract shows it, from what agy reported of it so far (its `tool_call` with each
 * `tool_call_update` laid over it): the same for a call streamed live and one a `session/load` replays. agy names
 * its tools (`run_command`, `write_file`, `edit_file`, `read_file`, `ask_question`, `invoke_subagent`); the row of a
 * known one reads as what it acted on, any other keeps agy's own title.
 */

import { basename } from "node:path";
import { boundedJson, isRecord } from "../../../adapter-kit/bounded-json";
import { phoneName, phoneText } from "../../../adapter-kit/phone-text";
import { unifiedDiff } from "../../../adapter-kit/unified-diff";
import {
	type FileChange,
	type JsonValue,
	MAX_LIST_ITEMS,
	MAX_PATH_CHARS,
	type ToolOutcome,
	type ToolResult,
} from "../../../contract";
import type { ToolCallFields, ToolContent } from "../acp/frames";

export interface ToolState {
	readonly toolCallId: string;
	readonly title?: string;
	readonly name?: string;
	readonly kind?: string;
	readonly status?: string;
	readonly content: readonly ToolContent[];
	readonly locations: readonly { readonly path: string }[];
	readonly rawInput?: unknown;
	readonly rawOutput?: unknown;
}

export interface ToolLook {
	readonly name: string;
	readonly title?: string;
	readonly input?: JsonValue;
}

const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file"]);

/**
 * The call as first reported, or with an update laid over `before`: an absent field leaves its value, and a
 * new content or location list replaces the old one whole (ACP `tool_call_update`).
 */
export function toolState(fields: ToolCallFields, before?: ToolState): ToolState {
	const pick = <K extends "title" | "name" | "kind" | "status">(key: K) => fields[key] ?? before?.[key];
	const title = pick("title");
	const name = pick("name");
	const kind = pick("kind");
	const status = pick("status");
	const rawInput = fields.rawInput ?? before?.rawInput;
	const rawOutput = fields.rawOutput ?? before?.rawOutput;
	return {
		toolCallId: fields.toolCallId,
		...(title !== undefined && { title }),
		...(name !== undefined && { name }),
		...(kind !== undefined && { kind }),
		...(status !== undefined && { status }),
		content: fields.content ?? before?.content ?? [],
		locations: fields.locations ?? before?.locations ?? [],
		...(rawInput !== undefined && { rawInput }),
		...(rawOutput !== undefined && { rawOutput }),
	};
}

export function toolLook(state: ToolState): ToolLook {
	const title = phoneName(titleOf(state) ?? "");
	return {
		name: phoneName(state.name ?? state.kind ?? "") || "tool",
		...(title !== "" && { title }),
		...(state.rawInput !== undefined && { input: boundedJson(state.rawInput) }),
	};
}

export interface ToolEnd {
	readonly outcome: ToolOutcome;
	readonly result: ToolResult;
}

/**
 * How the call ended, once agy says it has; undefined while it runs. agy 1.5.18 sends a command's exit code as
 * `rawOutput.exit_code`.
 */
export function toolEnd(state: ToolState): ToolEnd | undefined {
	if (state.status !== "completed" && state.status !== "failed") return undefined;
	const failed = state.status === "failed";
	const text = toolOutput(state);
	const exitCode = isRecord(state.rawOutput) ? state.rawOutput.exit_code : undefined;
	return {
		outcome: failed ? "failed" : "completed",
		result: {
			content: text === "" ? [] : [{ kind: "text", text }],
			fileChanges: fileChangesOf(state.content),
			...(failed && { error: text || "agy reported that the tool failed" }),
			...(typeof exitCode === "number" && Number.isSafeInteger(exitCode) && { exitCode }),
		},
	};
}

function titleOf(state: ToolState): string | undefined {
	const input = state.rawInput;
	if (state.name === "run_command") return firstLine(textField(input, "CommandLine")) ?? state.title;
	if (state.name !== undefined && FILE_TOOLS.has(state.name)) {
		const path = filePathOf(state);
		return path === undefined ? state.title : basename(path);
	}
	if (state.name === "ask_question") return "Question";
	if (state.name === "invoke_subagent") {
		const role = firstLine(textField(input, "Role"));
		return role === undefined ? "Subagent" : `Subagent: ${role}`;
	}
	return state.title;
}

function filePathOf(state: ToolState): string | undefined {
	const diff = state.content.find((item) => item.type === "diff");
	if (diff?.type === "diff") return diff.path;
	return state.locations[0]?.path ?? textField(state.rawInput, "Path");
}

/** A command's output is `rawOutput.output`; any other tool's is the text it sent as content. */
export function toolOutput(state: ToolState): string {
	const output = textField(state.rawOutput, "output");
	const content = state.content
		.flatMap((item) => (item.type === "content" && item.content.type === "text" ? [item.content.text ?? ""] : []))
		.join("\n");
	if (state.name === "run_command" && output !== undefined) return phoneText(output);
	return phoneText(content || output || "");
}

/** The files a call's `diff` content changes: no `oldText` is a file the call writes anew. */
export function fileChangesOf(content: readonly ToolContent[]): FileChange[] {
	return content
		.flatMap((item): FileChange[] => {
			if (item.type !== "diff" || item.path === "" || item.path.length > MAX_PATH_CHARS) return [];
			const { diff, additions, deletions } = unifiedDiff(item.path, item.oldText, item.newText);
			const change = item.oldText === undefined ? "added" : "modified";
			return [{ path: item.path, change, ...(diff !== "" && { diff }), additions, deletions }];
		})
		.slice(0, MAX_LIST_ITEMS);
}

/** A string argument the call was given, when it is one and not blank. */
export function toolArgument(state: ToolState, key: string): string | undefined {
	return textField(state.rawInput, key);
}

function textField(value: unknown, key: string): string | undefined {
	const field = isRecord(value) ? value[key] : undefined;
	return typeof field === "string" && field.trim() !== "" ? field : undefined;
}

function firstLine(text: string | undefined): string | undefined {
	return text
		?.split("\n")
		.find((line) => line.trim() !== "")
		?.trim();
}
