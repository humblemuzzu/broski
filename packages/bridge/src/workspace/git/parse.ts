import type { GitBranch, GitChangeStatus, GitFileChange, GitLogEntry, GitStatusResult } from "./types";

export const LOG_FORMAT = "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e";
export const BRANCH_FORMAT = "--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(HEAD)";

function normalizeStatusChar(char: string): GitChangeStatus {
	switch (char.toUpperCase()) {
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		default:
			return "modified";
	}
}

/** `git status --porcelain=v2 --branch` output. */
export function parseGitStatus(stdout: string): GitStatusResult {
	const staged: GitFileChange[] = [];
	const unstaged: GitFileChange[] = [];
	const untracked: string[] = [];

	let branch = "";
	let upstream: string | null = null;
	let ahead = 0;
	let behind = 0;

	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!line) continue;

		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			branch = head === "(detached)" ? "detached" : head;
			continue;
		}

		if (line.startsWith("# branch.upstream ")) {
			const up = line.slice("# branch.upstream ".length).trim();
			upstream = up || null;
			continue;
		}

		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/);
			if (match) {
				ahead = Number(match[1] || "0") || 0;
				behind = Number(match[2] || "0") || 0;
			}
			continue;
		}

		if (line.startsWith("? ")) {
			const path = line.slice(2).trim();
			if (path) untracked.push(path);
			continue;
		}

		if (!line.startsWith("1 ") && !line.startsWith("2 ")) continue;

		const kind = line[0];
		const xy = line.slice(2, 4);
		const x = xy[0] ?? " ";
		const y = xy[1] ?? " ";

		let path = "";
		let oldPath: string | undefined;

		if (kind === "2") {
			const [left, right] = line.split("\t");
			const leftParts = (left ?? "").trim().split(/\s+/);
			path = leftParts[leftParts.length - 1] || "";
			oldPath = right?.trim() || undefined;
		} else {
			const parts = line.trim().split(/\s+/);
			path = parts[parts.length - 1] || "";
		}

		if (!path) continue;
		const status = normalizeStatusChar(x !== "." && x !== " " ? x : y);
		const change = { path, status, ...(oldPath ? { oldPath } : {}) };

		if (x !== "." && x !== " ") staged.push(change);
		if (y !== "." && y !== " ") unstaged.push(change);
	}

	return {
		branch,
		upstream,
		ahead,
		behind,
		staged,
		unstaged,
		untracked,
	};
}

/** `git log` with `LOG_FORMAT`: fields split by U+001F, entries by U+001E. */
export function parseGitLog(stdout: string): GitLogEntry[] {
	const entries: GitLogEntry[] = [];

	for (const chunk of stdout.split("\x1e")) {
		const row = chunk.trim();
		if (!row) continue;
		const cols = row.split("\x1f");
		if (cols.length < 6) continue;
		entries.push({
			hash: cols[0] || "",
			shortHash: cols[1] || "",
			author: cols[2] || "",
			email: cols[3] || "",
			timestamp: Number(cols[4] || "0") || 0,
			subject: cols.slice(5).join("\x1f"),
		});
	}

	return entries;
}

/** `git branch -a` with `BRANCH_FORMAT`. */
export function parseGitBranches(stdout: string): GitBranch[] {
	const out: GitBranch[] = [];

	for (const rawLine of stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const [fullRef, shortRef, upstream, tracking, head] = line.split("|");
		const full = (fullRef || "").trim();
		const short = (shortRef || "").trim();
		if (!short) continue;

		const isRemote = full.startsWith("refs/remotes/");
		const cleanedName = isRemote && short.startsWith("remotes/") ? short.slice("remotes/".length) : short;

		out.push({
			name: cleanedName,
			upstream: (upstream || "").trim() || null,
			tracking: (tracking || "").trim() || null,
			isCurrent: (head || "").trim() === "*",
			isRemote,
		});
	}

	return out;
}
