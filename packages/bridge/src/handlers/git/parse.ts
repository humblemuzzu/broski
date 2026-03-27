import type { RepoRef } from "./types";

function normalizeStatusChar(char: string): "modified" | "added" | "deleted" | "renamed" | "copied" {
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

export function parseGitStatus(stdout: string) {
	const staged: Array<{
		path: string;
		status: "modified" | "added" | "deleted" | "renamed" | "copied";
		oldPath?: string;
	}> = [];
	const unstaged: Array<{
		path: string;
		status: "modified" | "added" | "deleted" | "renamed" | "copied";
		oldPath?: string;
	}> = [];
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

export function parseGitLog(stdout: string) {
	const entries: Array<{
		hash: string;
		shortHash: string;
		author: string;
		email: string;
		timestamp: number;
		subject: string;
	}> = [];

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

export function parseGitBranches(stdout: string) {
	const out: Array<{
		name: string;
		upstream: string | null;
		tracking: string | null;
		isCurrent: boolean;
		isRemote: boolean;
	}> = [];

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

export function parseRepoFromRemote(remoteUrl: string): RepoRef | null {
	const url = remoteUrl.trim();
	if (!url) return null;

	const sshMatch = url.match(/^git@([^:]+):([^/]+)\/([^\s]+?)(?:\.git)?$/);
	if (sshMatch) {
		return {
			host: sshMatch[1]!,
			owner: sshMatch[2]!,
			repo: sshMatch[3]!,
		};
	}

	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		const parts = parsed.pathname
			.replace(/^\/+/, "")
			.replace(/\.git$/, "")
			.split("/")
			.filter(Boolean);
		if (parts.length < 2) return null;
		return {
			host,
			owner: parts[0]!,
			repo: parts[1]!,
		};
	} catch {
		return null;
	}
}

export function repoSlug(repo: RepoRef): string {
	if (repo.host && repo.host !== "github.com") {
		return `${repo.host}/${repo.owner}/${repo.repo}`;
	}
	return `${repo.owner}/${repo.repo}`;
}

export function normalizeGithubState(value: unknown): "open" | "closed" | "all" {
	const v = String(value || "")
		.trim()
		.toLowerCase();
	if (v === "closed") return "closed";
	if (v === "all") return "all";
	return "open";
}
