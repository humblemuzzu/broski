/**
 * What changes a repository: staging, commits, branches, the stash and the remote. As in `read.ts`, every
 * `cwd` has already passed the bridge's directory policy, and every path, ref and message is checked here.
 */

import { git, refused } from "./command";
import { isSafeBranchName, isSafePathSpec, isSafeRef, sanitizeCommitMessage } from "./security";
import type { GitCommitted, GitResult } from "./types";

type Done = GitResult<null>;

async function run(args: string[], cwd: string, failure: string): Promise<Done> {
	const out = await git(args, cwd, failure);
	return out.ok ? { ok: true, value: null } : out;
}

/** Stages one path, or everything when no path is given. */
export async function gitStage(cwd: string, path?: string): Promise<Done> {
	const spec = path?.trim() ?? "";
	if (spec && !isSafePathSpec(spec)) return refused("Invalid path");
	return run(spec ? ["add", "--", spec] : ["add", "-A"], cwd, "git add failed");
}

/** Unstages one path, or everything when no path is given. */
export async function gitUnstage(cwd: string, path?: string): Promise<Done> {
	const spec = path?.trim() ?? "";
	if (spec && !isSafePathSpec(spec)) return refused("Invalid path");
	return run(spec ? ["restore", "--staged", "--", spec] : ["reset", "HEAD"], cwd, "git unstage failed");
}

/** Discards the working-tree changes of one path. */
export async function gitRevertFile(cwd: string, path: string): Promise<Done> {
	const spec = path.trim();
	if (!spec || !isSafePathSpec(spec)) return refused("Invalid path");
	return run(["restore", "--worktree", "--", spec], cwd, "git restore failed");
}

export async function gitCommit(cwd: string, message: string): Promise<GitResult<GitCommitted>> {
	const text = sanitizeCommitMessage(message);
	if (!text.trim()) return refused("Commit message cannot be empty");
	const committed = await run(["commit", "-m", text], cwd, "git commit failed");
	if (!committed.ok) return committed;
	const latest = await git(["log", "-1", "--format=%H%x1f%s"], cwd, "Failed to read latest commit");
	if (!latest.ok) return latest;
	const [hash = "", subject = ""] = latest.value.trim().split("\x1f");
	return { ok: true, value: { hash, subject } };
}

/** Pushes the current branch; `force` is `--force-with-lease`, never a bare force. */
export async function gitPush(cwd: string, force = false): Promise<Done> {
	return run(force ? ["push", "--force-with-lease"] : ["push"], cwd, "git push failed");
}

/** Pulls the current branch, rebasing unless `rebase` is false. */
export async function gitPull(cwd: string, rebase = true): Promise<Done> {
	return run(rebase ? ["pull", "--rebase"] : ["pull", "--no-rebase"], cwd, "git pull failed");
}

export async function gitFetch(cwd: string): Promise<Done> {
	return run(["fetch", "--all", "--prune"], cwd, "git fetch failed");
}

export async function gitCheckout(cwd: string, branch: string): Promise<GitResult<{ branch: string }>> {
	const name = branch.trim();
	if (!isSafeBranchName(name)) return refused("Invalid branch name");
	const out = await run(["switch", name], cwd, "git switch failed");
	return out.ok ? { ok: true, value: { branch: name } } : out;
}

/** Creates a branch at `startPoint` (HEAD when absent) and switches to it. */
export async function gitCreateBranch(
	cwd: string,
	name: string,
	startPoint?: string,
): Promise<GitResult<{ name: string }>> {
	const branch = name.trim();
	const start = startPoint?.trim() ?? "";
	if (!isSafeBranchName(branch)) return refused("Invalid branch name");
	if (start && !isSafeRef(start)) return refused("Invalid start point");
	const out = await run(["switch", "-c", branch, ...(start ? [start] : [])], cwd, "git branch create failed");
	return out.ok ? { ok: true, value: { name: branch } } : out;
}

/** Stashes every change, untracked files included. */
export async function gitStash(cwd: string): Promise<Done> {
	return run(["stash", "push", "-u"], cwd, "git stash failed");
}

export async function gitStashPop(cwd: string): Promise<Done> {
	return run(["stash", "pop"], cwd, "git stash pop failed");
}
