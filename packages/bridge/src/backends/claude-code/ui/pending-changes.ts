/**
 * The change an `Edit` or `Write` ask would make, for its preview. The ask carries only the call's input, so the file is
 * read to place an edit at its lines (whole lines, numbered as the file numbers them) and to tell a new file from an
 * overwrite. A file past the bound, one that cannot be read, or an edit whose text the file no longer holds gives no
 * preview: the ask still names the path.
 */

import { readFileSync, statSync } from "node:fs";
import type { FileChange } from "../../../contract";
import { diffOfNewFile, diffOfReplacement } from "../mapping/patch-text";

/** Files read to place an edit; an ask waits on a person, so a bounded read here costs nothing they would notice. */
const MAX_READ_BYTES = 2 * 1024 * 1024;

export function pendingChanges(toolName: string, input: Readonly<Record<string, unknown>>): FileChange[] {
	const path = text(input.file_path);
	if (path === undefined || path === "") return [];
	if (toolName === "Edit") return pendingEdit(path, input);
	if (toolName === "Write") return pendingWrite(path, input);
	return [];
}

/** An edit of every occurrence (`replace_all`) would show only its first, so it shows none. */
function pendingEdit(path: string, input: Readonly<Record<string, unknown>>): FileChange[] {
	const oldText = text(input.old_string);
	const newText = text(input.new_string);
	if (oldText === undefined || oldText === "" || newText === undefined || input.replace_all === true) return [];
	const content = readBounded(path);
	const at = content?.indexOf(oldText) ?? -1;
	if (content === undefined || at < 0) return [];
	const lineStart = content.lastIndexOf("\n", at - 1) + 1;
	const after = at + oldText.length;
	const newline = content.indexOf("\n", after);
	const lineEnd = newline < 0 ? content.length : newline;
	const before = content.slice(lineStart, lineEnd);
	const replaced = content.slice(lineStart, at) + newText + content.slice(after, lineEnd);
	const startLine = lineCountBefore(content, lineStart) + 1;
	const diff = diffOfReplacement(path, before, replaced, startLine);
	return diff === undefined ? [] : [{ path, change: "modified", ...diff }];
}

/** Over an existing file a write is shown by its path alone: the whole file twice is no preview. */
function pendingWrite(path: string, input: Readonly<Record<string, unknown>>): FileChange[] {
	const content = text(input.content);
	if (content === undefined || exists(path)) return [];
	const diff = diffOfNewFile(path, content);
	return diff === undefined ? [] : [{ path, change: "added", ...diff }];
}

/** A regular file only: a pipe or a device would block the bridge on a read that never ends. */
function readBounded(path: string): string | undefined {
	try {
		const stat = statSync(path);
		return stat.isFile() && stat.size <= MAX_READ_BYTES ? readFileSync(path, "utf8") : undefined;
	} catch {
		return undefined;
	}
}

/** Only a missing file is a new one; a file the bridge may not look at could be anything. */
function exists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch (error) {
		return !(error instanceof Error && "code" in error && error.code === "ENOENT");
	}
}

function lineCountBefore(content: string, end: number): number {
	let lines = 0;
	for (let at = content.indexOf("\n"); at >= 0 && at < end; at = content.indexOf("\n", at + 1)) lines += 1;
	return lines;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
