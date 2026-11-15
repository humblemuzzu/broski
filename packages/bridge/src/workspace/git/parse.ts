import type { GitBranch, GitChange, GitCommit, GitFileChange, GitUpstream } from "../../contract";

export const LOG_FORMAT = "--format=%H%x1f%an%x1f%at%x1f%s%x1e";
export const REF_FORMAT =
	"--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)%00%(symref)";

/** `git status --porcelain=v2 --branch -z`, before the line counts are added. */
export interface ParsedStatus {
	branch?: string;
	head?: string;
	upstream?: GitUpstream;
	readonly staged: GitFileChange[];
	readonly unstaged: GitFileChange[];
	readonly untracked: string[];
}

/** A change letter of porcelain v2's `XY` field; `.` is no change. */
function changeOf(letter: string): GitChange | undefined {
	switch (letter) {
		case "A":
			return "added";
		case "M":
			return "modified";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "T":
			return "type_changed";
		default:
			return undefined;
	}
}

/**
 * Fields are split on single spaces up to the path, which is the rest of the record: paths keep their spaces.
 * A rename or copy (`2`) is followed by a record holding the path it came from.
 */
export function parseStatus(stdout: string): ParsedStatus {
	const parsed: ParsedStatus = { staged: [], unstaged: [], untracked: [] };
	const records = stdout.split("\0");
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index] ?? "";
		if (record.startsWith("# ")) readHeader(parsed, record.slice(2));
		else if (record.startsWith("? ")) parsed.untracked.push(record.slice(2));
		else if (record.startsWith("u "))
			parsed.unstaged.push({ path: fieldsAndPath(record, 10).path, change: "conflicted" });
		else if (record.startsWith("1 ")) addChange(parsed, fieldsAndPath(record, 8));
		else if (record.startsWith("2 ")) {
			index += 1;
			addChange(parsed, fieldsAndPath(record, 9), records[index]);
		}
	}
	return parsed;
}

function readHeader(parsed: ParsedStatus, header: string): void {
	const [key = "", value = ""] = splitOnce(header, " ");
	if (key === "branch.oid" && value !== "(initial)") parsed.head = value;
	else if (key === "branch.head" && value !== "(detached)") parsed.branch = value;
	else if (key === "branch.upstream") parsed.upstream = { name: value, ahead: 0, behind: 0 };
	else if (key === "branch.ab" && parsed.upstream) {
		const match = /^\+(\d+) -(\d+)$/.exec(value);
		if (match) parsed.upstream = { ...parsed.upstream, ahead: Number(match[1]), behind: Number(match[2]) };
	}
}

function addChange(parsed: ParsedStatus, record: { fields: string[]; path: string }, previousPath?: string): void {
	const xy = record.fields[1] ?? "..";
	const from = previousPath ? { previousPath } : {};
	const staged = changeOf(xy.charAt(0));
	const unstaged = changeOf(xy.charAt(1));
	if (staged) parsed.staged.push({ path: record.path, ...from, change: staged });
	if (unstaged) parsed.unstaged.push({ path: record.path, ...(unstaged === "renamed" ? from : {}), change: unstaged });
}

/** The first `count` space-separated fields of a record, and the path after them. */
function fieldsAndPath(record: string, count: number): { fields: string[]; path: string } {
	const fields: string[] = [];
	let rest = record;
	for (let field = 0; field < count; field += 1) {
		const [head = "", tail = ""] = splitOnce(rest, " ");
		fields.push(head);
		rest = tail;
	}
	return { fields, path: rest };
}

function splitOnce(text: string, separator: string): [string, string] {
	const at = text.indexOf(separator);
	return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at + separator.length)];
}

export type LineCounts = { additions: number; deletions: number };

/** Line counts by path from `git diff --numstat -z`; a binary file (`-`) has none. A rename is keyed by its new path. */
export function parseNumstat(stdout: string): Map<string, LineCounts | undefined> {
	const counts = new Map<string, LineCounts | undefined>();
	const records = stdout.split("\0");
	for (let index = 0; index < records.length; index += 1) {
		const [additions = "", deletions = "", named = ""] = (records[index] ?? "").split("\t");
		if (!additions) continue;
		let path = named;
		if (!path) {
			index += 2;
			path = records[index] ?? "";
		}
		counts.set(path, additions === "-" ? undefined : { additions: Number(additions), deletions: Number(deletions) });
	}
	return counts;
}

/** `git log` with `LOG_FORMAT`: fields split by U+001F, entries by U+001E. */
export function parseLog(stdout: string): GitCommit[] {
	return stdout.split("\x1e").flatMap((chunk) => {
		const [hash = "", author = "", at = "", ...subject] = chunk.replace(/^\n/, "").split("\x1f");
		return hash ? [{ hash, author, authoredAt: Number(at) * 1000, subject: subject.join("\x1f") }] : [];
	});
}

/**
 * `git for-each-ref` with `REF_FORMAT`, one ref a line, fields split by NUL. The plumbing command's tracking
 * words are never translated, unlike `git branch`'s. Symbolic refs such as `origin/HEAD` are left out.
 */
export function parseRefs(stdout: string): GitBranch[] {
	return stdout.split("\n").flatMap((line): GitBranch[] => {
		const [ref = "", name = "", upstream = "", track = "", head = "", symref = ""] = line.split("\0");
		if (!name || symref) return [];
		return [
			{
				name,
				remote: ref.startsWith("refs/remotes/"),
				current: head === "*",
				...(upstream && { upstream: { name: upstream, ...tracking(track) } }),
			},
		];
	});
}

function tracking(track: string): { ahead: number; behind: number } {
	const ahead = /ahead (\d+)/.exec(track);
	const behind = /behind (\d+)/.exec(track);
	return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 };
}
