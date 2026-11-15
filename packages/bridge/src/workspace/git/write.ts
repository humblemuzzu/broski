/**
 * What changes a repository: staging, a commit, a switch of branch. As in `read.ts`, `root` has passed the path
 * policy and every path and branch is checked here. Paths and messages reach git on its standard input, so no
 * count or length of them meets the system's limit on a command line.
 */

import type { ActionResult, GitCheckoutResult, GitCommitResult } from "../../contract";
import { ACCEPTED, rejected } from "../results";
import { git } from "./command";
import { LOG_FORMAT, parseLog } from "./parse";
import { isSafeBranchName, isSafePathSpec } from "./security";

const FROM_STDIN = ["--pathspec-from-file=-", "--pathspec-file-nul"];

export async function gitStage(root: string, paths: readonly string[]): Promise<ActionResult> {
	return withPaths(root, paths, ["add", ...FROM_STDIN], "git add failed");
}

/** Works before the first commit too, where there is no HEAD to restore from. */
export async function gitUnstage(root: string, paths: readonly string[]): Promise<ActionResult> {
	return withPaths(root, paths, ["reset", "--quiet", ...FROM_STDIN], "git reset failed");
}

async function withPaths(
	root: string,
	paths: readonly string[],
	args: string[],
	failure: string,
): Promise<ActionResult> {
	const unsafe = paths.find((path) => !isSafePathSpec(path));
	if (unsafe !== undefined) return rejected("invalid_input", `${unsafe} is not a path inside the repository`);
	const out = await git(args, root, failure, { input: paths.join("\0") });
	return out.status === "rejected" ? out : ACCEPTED;
}

/** Commits what is staged; what git says when it will not (nothing staged, no identity, a hook) is the rejection. */
export async function gitCommit(root: string, message: string): Promise<GitCommitResult> {
	if (message.includes("\0")) return rejected("invalid_input", "a commit message cannot hold a NUL character");
	if (!message.trim()) return rejected("invalid_input", "the commit message is empty");
	const committed = await git(["commit", "--file=-"], root, "git commit failed", { input: message });
	if (committed.status === "rejected") return committed;
	const latest = await git(["log", LOG_FORMAT, "-n", "1"], root, "git log failed");
	if (latest.status === "rejected") return latest;
	const [commit] = parseLog(latest.stdout);
	return commit ? { status: "accepted", commit } : rejected("backend_error", "git committed but shows no commit");
}

/**
 * Switches to `branch`; a remote branch's name without its remote makes the local branch that tracks it, as
 * `git switch` guesses. Local changes the switch would overwrite make git refuse, and say which.
 */
export async function gitCheckout(root: string, branch: string): Promise<GitCheckoutResult> {
	if (!isSafeBranchName(branch)) return rejected("invalid_input", `${branch} is not a branch name`);
	const out = await git(["switch", branch], root, "git switch failed");
	return out.status === "rejected" ? out : { status: "accepted", branch };
}
