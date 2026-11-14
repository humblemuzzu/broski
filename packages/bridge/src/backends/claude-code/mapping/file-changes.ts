/** The files a tool call changed, from `structuredPatch`/`gitDiff`: the same live, in history, in an ask and in the tail. */

import { type FileChange, MAX_PATH_CHARS } from "../../../contract";
import { isRecord } from "../json";
import { type DiffText, diffOfCell, diffOfGitPatch, diffOfHunks, diffOfNewFile, hunksOf } from "./patch-text";

type Output = Record<string, unknown>;

/**
 * What `Write`, `Edit` and `NotebookEdit` report in `tool_use_result` (`FileWriteOutput`, `FileEditOutput`,
 * `NotebookEditOutput`); any other tool changes no file this adapter can name. A write the owner has yet to review
 * (`staged`) changed nothing. `input` names the file only when the result does not.
 */
export function fileChangesOf(toolName: string, input: unknown, toolUseResult: unknown): FileChange[] {
	if (!isRecord(toolUseResult) || toolUseResult.staged === true) return [];
	switch (toolName) {
		case "Write":
			return write(toolUseResult, input);
		case "Edit":
			return edit(toolUseResult, input);
		case "NotebookEdit":
			return notebook(toolUseResult, input);
		default:
			return [];
	}
}

function usablePath(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" && value.length <= MAX_PATH_CHARS ? value : undefined;
}

function change(kind: FileChange["change"], path: string, text: DiffText | undefined): FileChange[] {
	return [
		{
			path,
			change: kind,
			...(text && {
				diff: text.diff,
				additions: text.additions,
				deletions: text.deletions,
			}),
		},
	];
}

/** The tool's own hunks first, then `gitDiff`. */
function patched(path: string, output: Output, created: boolean): DiffText | undefined {
	return (
		diffOfHunks(path, hunksOf(output.structuredPatch), created) ??
		(isRecord(output.gitDiff) ? diffOfGitPatch(path, output.gitDiff.patch, output.gitDiff) : undefined)
	);
}

function write(output: Output, input: unknown): FileChange[] {
	const path = usablePath(output.filePath) ?? (isRecord(input) ? usablePath(input.file_path) : undefined);
	if (path === undefined) return [];
	const created = output.type === "create";
	const whole = created && typeof output.content === "string" ? diffOfNewFile(path, output.content) : undefined;
	return change(created ? "added" : "modified", path, patched(path, output, created) ?? whole);
}

function edit(output: Output, input: unknown): FileChange[] {
	const path = usablePath(output.filePath) ?? (isRecord(input) ? usablePath(input.file_path) : undefined);
	return path === undefined ? [] : change("modified", path, patched(path, output, false));
}

function notebook(output: Output, input: unknown): FileChange[] {
	if (typeof output.error === "string" && output.error !== "") return [];
	const path = usablePath(output.notebook_path) ?? (isRecord(input) ? usablePath(input.notebook_path) : undefined);
	if (path === undefined) return [];
	const oldSource = typeof output.old_source === "string" ? output.old_source : undefined;
	const newSource =
		typeof output.new_source === "string" && output.edit_mode !== "delete" ? output.new_source : undefined;
	return change("modified", path, diffOfCell(path, oldSource, newSource));
}
