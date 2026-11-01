/** Lane B · unified diffs from what the file tools report: `structuredPatch` hunks, `gitDiff.patch`, a new file's content. */

import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import { isRecord } from "../json";

export interface Hunk {
	readonly oldStart: number;
	readonly oldLines: number;
	readonly newStart: number;
	readonly newLines: number;
	readonly lines: readonly string[];
}

export interface DiffText {
	readonly diff: string;
	readonly additions: number;
	readonly deletions: number;
}

const NO_PATH = "/dev/null";

function counter(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** `structuredPatch` as the tools declare it (`FileEditOutput`, `FileWriteOutput`); entries of another shape are skipped. */
export function hunksOf(value: unknown): Hunk[] {
	if (!Array.isArray(value)) return [];
	const hunks: Hunk[] = [];
	for (const entry of value.slice(0, MAX_LIST_ITEMS)) {
		if (!isRecord(entry) || !Array.isArray(entry.lines)) continue;
		const { oldStart, oldLines, newStart, newLines } = {
			oldStart: counter(entry.oldStart),
			oldLines: counter(entry.oldLines),
			newStart: counter(entry.newStart),
			newLines: counter(entry.newLines),
		};
		if (oldStart === undefined || oldLines === undefined || newStart === undefined || newLines === undefined) continue;
		const lines = entry.lines.filter((line: unknown): line is string => typeof line === "string");
		hunks.push({ oldStart, oldLines, newStart, newLines, lines });
	}
	return hunks;
}

function header(oldPath: string, newPath: string): string {
	return `--- ${oldPath}\n+++ ${newPath}`;
}

/** Added and removed lines; `fileHeaders` skips the `---`/`+++` lines of a diff that carries its own. */
function countLines(lines: Iterable<string>, fileHeaders: boolean): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.startsWith("+") && !(fileHeaders && line.startsWith("+++ "))) additions += 1;
		else if (line.startsWith("-") && !(fileHeaders && line.startsWith("--- "))) deletions += 1;
	}
	return { additions, deletions };
}

export function diffOfHunks(path: string, hunks: readonly Hunk[], created: boolean): DiffText | undefined {
	if (hunks.length === 0) return undefined;
	const parts = [header(created ? NO_PATH : path, path)];
	for (const hunk of hunks) {
		parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines);
	}
	return {
		diff: clip(parts.join("\n"), MAX_TEXT_CHARS),
		...countLines(
			hunks.flatMap((hunk) => hunk.lines),
			false,
		),
	};
}

/** `gitDiff.patch` is hunks without file headers; the counts are the ones the tool reports when it reports them. */
export function diffOfGitPatch(path: string, patch: unknown, counts: unknown): DiffText | undefined {
	if (typeof patch !== "string" || patch.trim() === "") return undefined;
	const body = patch.startsWith("--- ") || patch.startsWith("diff ") ? patch : `${header(path, path)}\n${patch}`;
	const counted = countLines(patch.split("\n"), true);
	const given = isRecord(counts)
		? {
				additions: counter(counts.additions),
				deletions: counter(counts.deletions),
			}
		: {};
	return {
		diff: clip(body, MAX_TEXT_CHARS),
		additions: given.additions ?? counted.additions,
		deletions: given.deletions ?? counted.deletions,
	};
}

function lineCount(text: string): number {
	let lines = 0;
	for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lines += 1;
	return text.endsWith("\n") ? lines : lines + 1;
}

/** A file written whole: every line added. Only the diff's first `MAX_TEXT_CHARS` are built, the count is of all of it. */
export function diffOfNewFile(path: string, content: string): DiffText | undefined {
	if (content === "") return undefined;
	const total = lineCount(content);
	const head = content.length > MAX_TEXT_CHARS ? content.slice(0, MAX_TEXT_CHARS) : content;
	const lines = head.endsWith("\n") ? head.slice(0, -1).split("\n") : head.split("\n");
	const body = lines.map((line) => `+${line}`);
	return {
		diff: clip([header(NO_PATH, path), `@@ -0,0 +1,${total} @@`, ...body].join("\n"), MAX_TEXT_CHARS),
		additions: total,
		deletions: 0,
	};
}

/** One notebook cell replaced, inserted or deleted. */
export function diffOfCell(
	path: string,
	oldSource: string | undefined,
	newSource: string | undefined,
): DiffText | undefined {
	const removed = oldSource === undefined || oldSource === "" ? [] : oldSource.split("\n");
	const added = newSource === undefined || newSource === "" ? [] : newSource.split("\n");
	if (removed.length === 0 && added.length === 0) return undefined;
	const body = [...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)];
	return {
		diff: clip(
			[header(path, path), `@@ -1,${removed.length} +1,${added.length} @@`, ...body].join("\n"),
			MAX_TEXT_CHARS,
		),
		additions: added.length,
		deletions: removed.length,
	};
}
