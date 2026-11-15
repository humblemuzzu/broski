import { type GitDiffFile, type GitDiffHunk, MAX_DIFF_LINES, MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../contract";
import { readQuoted, unquotePath } from "./quoted-path";

export interface ParsedDiff {
	readonly files: GitDiffFile[];
	readonly truncated: boolean;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * `git diff` output (prefixes `a/` and `b/`, no colour) as files, hunks and lines. It stops at the first line
 * past `budget` characters of line text or `MAX_DIFF_LINES` lines, or at a file past `MAX_LIST_ITEMS`, and
 * says it was truncated. A conflicted file's combined diff is listed without hunks.
 */
export function parseDiff(text: string, budget: number): ParsedDiff {
	const reader = new DiffReader(budget);
	for (const line of text.split("\n")) {
		if (!reader.read(line)) return { files: reader.files, truncated: true };
	}
	return { files: reader.files, truncated: false };
}

class DiffReader {
	readonly files: GitDiffFile[] = [];
	private file: GitDiffFile | undefined;
	private hunk: GitDiffHunk | undefined;
	/** The line numbers the hunk's next old-side and new-side lines have. */
	private nextOld = 0;
	private nextNew = 0;
	private combined = false;
	private lines = 0;
	private chars = 0;

	constructor(private readonly budget: number) {}

	/** False once a bound is reached. */
	read(line: string): boolean {
		if (line.startsWith("diff --git ")) return this.startFile(headerPath(line.slice("diff --git ".length)), false);
		if (line.startsWith("diff --cc ")) return this.startFile(unquotePath(line.slice("diff --cc ".length)), true);
		if (!this.file || this.combined) return true;
		if (line.startsWith("@@")) this.startHunk(line);
		else if (this.hunk) return this.readLine(this.hunk, line);
		else readHeader(this.file, line);
		return true;
	}

	private startFile(path: string, combined: boolean): boolean {
		if (this.files.length >= MAX_LIST_ITEMS) return false;
		this.file = { path, change: combined ? "conflicted" : "modified", binary: false, hunks: [] };
		this.files.push(this.file);
		this.hunk = undefined;
		this.combined = combined;
		return true;
	}

	private startHunk(line: string): void {
		const match = HUNK_HEADER.exec(line);
		if (!match || !this.file) return;
		const [, oldStart = "0", oldLines = "1", newStart = "0", newLines = "1", header = ""] = match;
		this.hunk = {
			oldStart: Number(oldStart),
			oldLines: Number(oldLines),
			newStart: Number(newStart),
			newLines: Number(newLines),
			...(header && { header: header.slice(0, MAX_NAME_CHARS) }),
			lines: [],
		};
		this.nextOld = Number(oldStart);
		this.nextNew = Number(newStart);
		this.file.hunks.push(this.hunk);
	}

	private readLine(hunk: GitDiffHunk, line: string): boolean {
		const marker = line.charAt(0);
		if (marker === "\\") {
			const last = hunk.lines.at(-1);
			if (last) last.noNewline = true;
			return true;
		}
		if (marker !== " " && marker !== "+" && marker !== "-") return true;
		const text = line.slice(1);
		if (this.lines + 1 > MAX_DIFF_LINES || this.chars + text.length > this.budget) return false;
		this.lines += 1;
		this.chars += text.length;
		if (marker === "+") hunk.lines.push({ kind: "added", text, newLine: this.nextNew++ });
		else if (marker === "-") hunk.lines.push({ kind: "removed", text, oldLine: this.nextOld++ });
		else hunk.lines.push({ kind: "context", text, oldLine: this.nextOld++, newLine: this.nextNew++ });
		return true;
	}
}

/** One extended header line of a file's diff, before its first hunk. */
function readHeader(file: GitDiffFile, line: string): void {
	const [key, value] = headerField(line);
	switch (key) {
		case "new file mode":
			file.change = "added";
			return;
		case "deleted file mode":
			file.change = "deleted";
			return;
		case "rename from":
		case "copy from":
			file.previousPath = unquotePath(value);
			file.change = key === "rename from" ? "renamed" : "copied";
			return;
		case "rename to":
		case "copy to":
			file.path = unquotePath(value);
			return;
		case "Binary files":
			file.binary = true;
			return;
		case "---":
		case "+++":
			if (value !== "/dev/null") file.path = sidePath(value, key === "---" ? "a/" : "b/");
	}
}

const HEADER_KEYS = [
	"new file mode",
	"deleted file mode",
	"rename from",
	"rename to",
	"copy from",
	"copy to",
	"---",
	"+++",
];

function headerField(line: string): [string, string] {
	if (line.startsWith("Binary files ")) return ["Binary files", ""];
	const key = HEADER_KEYS.find((candidate) => line.startsWith(`${candidate} `));
	return key ? [key, line.slice(key.length + 1)] : ["", line];
}

/** A `---`/`+++` path: git ends one holding a space with a tab, and quotes one holding a control character. */
function sidePath(value: string, prefix: string): string {
	const path = unquotePath(value.endsWith("\t") ? value.slice(0, -1) : value);
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * The path a `diff --git a/X b/Y` header names. Unquoted, the two sides cannot be told apart by spaces, but an
 * unchanged path is the same on both, so the header splits in half; a renamed or copied one, whose sides
 * differ, is corrected by the `rename to`/`copy to` line that follows.
 */
function headerPath(rest: string): string {
	if (rest.startsWith('"')) return sidePath(readQuoted(rest)[1].trimStart(), "b/");
	const half = (rest.length - 1) / 2;
	const left = rest.slice(2, half);
	const right = rest.slice(half + 3);
	if (Number.isInteger(half) && left === right) return right;
	return sidePath(rest.slice(rest.lastIndexOf(" b/") + 1), "b/");
}
