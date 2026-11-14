import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { refused, runGit } from "./command";
import { isSafePathSpec } from "./security";
import type { GitResult, GitReviewFile, GitReviewMode } from "./types";

export const REVIEW_TEXT_MAX_CHARS = 100_000;

type ReviewStatus = GitReviewFile["status"];

/**
 * Every changed file with its text before and after, for a review: in `git` mode the unstaged changes of the
 * working tree against HEAD, in `branch` mode HEAD against the repository's default branch. `cwd` has passed
 * the bridge's directory policy.
 */
export async function gitReviewDiff(cwd: string, mode: GitReviewMode): Promise<GitResult<GitReviewFile[]>> {
	const base = mode === "branch" ? await defaultBranch(cwd) : "HEAD";
	if (base === null) return refused("Could not determine default branch");
	const range = mode === "branch" ? [`${base}...HEAD`] : [];

	let numstat = await runGit(["diff", "--numstat", "--diff-filter=ACDMR", "-z", ...range], cwd);
	if (numstat.exitCode !== 0 && mode === "branch") {
		numstat = await runGit(["diff", "--numstat", "--diff-filter=ACDMR", "-z", `${base}..HEAD`], cwd);
	}
	if (numstat.exitCode !== 0) return refused("git diff failed");

	const nameStatus = await runGit(["diff", "--name-status", "--diff-filter=ACDMR", ...range], cwd);
	const statuses = nameStatus.exitCode === 0 ? parseNameStatus(nameStatus.stdout) : new Map<string, ReviewStatus>();

	const files: GitReviewFile[] = [];
	for (const entry of numstat.stdout.split("\0").filter(Boolean)) {
		const parts = entry.split("\t");
		if (parts.length < 3) continue;
		const file = parts.slice(2).join("\t");
		if (!file || !isSafePathSpec(file)) continue;
		const status = statuses.get(file) ?? "modified";
		const before = status === "added" ? "" : await shown(cwd, `${base}:${file}`);
		const after =
			status === "deleted" ? "" : mode === "git" ? await worktreeText(cwd, file) : await shown(cwd, `HEAD:${file}`);
		files.push({ file, before, after, additions: count(parts[0]), deletions: count(parts[1]), status });
	}
	return { ok: true, value: files };
}

/** `origin/HEAD`'s branch, else `main`, else `master`; null when the repository has none of them. */
async function defaultBranch(cwd: string): Promise<string | null> {
	const symbolic = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd);
	if (symbolic.exitCode === 0 && symbolic.stdout.trim()) return symbolic.stdout.trim().replace(/^origin\//, "");
	for (const candidate of ["main", "master"]) {
		if ((await runGit(["rev-parse", "--verify", candidate], cwd)).exitCode === 0) return candidate;
	}
	return null;
}

/** `--name-status` lines: the change letter, then the path (the new one, for a rename or a copy). */
function parseNameStatus(stdout: string): Map<string, ReviewStatus> {
	const statuses = new Map<string, ReviewStatus>();
	for (const line of stdout.trim().split("\n")) {
		const parts = line.split("\t");
		const letter = parts[0]?.charAt(0);
		const file = parts[parts.length - 1];
		if (parts.length < 2 || !letter || !file) continue;
		statuses.set(file, letter === "A" ? "added" : letter === "D" ? "deleted" : "modified");
	}
	return statuses;
}

/** A numstat count; `-` is a binary file. */
function count(field: string | undefined): number {
	return field === undefined || field === "-" ? 0 : Number.parseInt(field, 10) || 0;
}

async function shown(cwd: string, object: string): Promise<string> {
	const result = await runGit(["show", object], cwd);
	return result.exitCode === 0 ? result.stdout.slice(0, REVIEW_TEXT_MAX_CHARS) : "";
}

/** The working-tree text of a file inside `cwd`; empty for one that cannot be read as text. */
async function worktreeText(cwd: string, file: string): Promise<string> {
	const root = resolve(cwd);
	const path = resolve(root, file);
	if (!path.startsWith(root + sep)) return "";
	try {
		return (await readFile(path, "utf-8")).slice(0, REVIEW_TEXT_MAX_CHARS);
	} catch {
		return "";
	}
}
