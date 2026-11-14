/**
 * What a repository is: its status, diffs, history and branches. Every `cwd` is a directory the caller has
 * already put through the bridge's directory policy (`getSecurePath`); the paths and refs a person typed
 * are checked here before git sees them.
 */

import { git, refused } from "./command";
import { BRANCH_FORMAT, LOG_FORMAT, parseGitBranches, parseGitLog, parseGitStatus } from "./parse";
import { clamp, isSafeHash, isSafePathSpec } from "./security";
import type { GitBranch, GitDiff, GitLogEntry, GitResult, GitStatusResult } from "./types";

const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 200;

export async function gitStatus(cwd: string): Promise<GitResult<GitStatusResult>> {
	const out = await git(["status", "--porcelain=v2", "--branch", "--untracked-files=all"], cwd, "git status failed");
	return out.ok ? { ok: true, value: parseGitStatus(out.value) } : out;
}

/** The diff of one path, or of the whole tree; of the index against HEAD when `staged`. */
export async function gitDiff(
	cwd: string,
	options: { path?: string; staged?: boolean } = {},
): Promise<GitResult<GitDiff>> {
	const path = options.path?.trim() ?? "";
	if (path && !isSafePathSpec(path)) return refused("Invalid path");
	const staged = options.staged === true;
	const args = ["diff", ...(staged ? ["--staged"] : []), "--", ...(path ? [path] : [])];
	const out = await git(args, cwd, "git diff failed");
	return out.ok ? { ok: true, value: { ...(path && { path }), diff: out.value, staged } } : out;
}

/** The newest commits of the current branch, `limit` of them (1 to 200, 50 when absent). */
export async function gitLog(cwd: string, limit = DEFAULT_LOG_LIMIT): Promise<GitResult<GitLogEntry[]>> {
	const count = clamp(Math.floor(limit), 1, MAX_LOG_LIMIT);
	const out = await git(["log", LOG_FORMAT, "-n", String(count)], cwd, "git log failed");
	return out.ok ? { ok: true, value: parseGitLog(out.value) } : out;
}

export async function gitBranches(cwd: string): Promise<GitResult<GitBranch[]>> {
	const out = await git(["branch", "-a", BRANCH_FORMAT], cwd, "git branch failed");
	return out.ok ? { ok: true, value: parseGitBranches(out.value) } : out;
}

/** The patch one commit made. */
export async function gitCommitDiff(cwd: string, hash: string): Promise<GitResult<string>> {
	const normalized = hash.trim().toLowerCase();
	if (!isSafeHash(normalized)) return refused("Invalid commit hash");
	return git(["show", normalized, "--format=", "--patch"], cwd, "git show failed");
}
