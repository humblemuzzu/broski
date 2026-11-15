/**
 * What a repository is: its status, a diff, its branches and history. `root` is the repository's top directory,
 * past the path policy (`repositoryRoot`); a path a person typed is checked here before git sees it.
 */

import type {
	GitBranchesResult,
	GitDiffResult,
	GitFileChange,
	GitLogResult,
	GitStatusResult,
	Rejected,
} from "../../contract";
import { rejected } from "../results";
import { type GitOutput, git } from "./command";
import { parseDiff } from "./diff-parse";
import { type LineCounts, LOG_FORMAT, parseLog, parseNumstat, parseRefs, parseStatus, REF_FORMAT } from "./parse";
import { isSafePathSpec } from "./security";

/** Enough for a status of every list full of long paths; more is cut and says so. */
const MAX_STATUS_BYTES = 16 * 1_048_576;

export async function gitStatus(root: string, limit: number): Promise<GitStatusResult> {
	const [status, staged, unstaged] = await Promise.all([
		git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], root, "git status failed", {
			maxStdoutBytes: MAX_STATUS_BYTES,
		}),
		git(["diff", "--cached", "--numstat", "-z"], root, "git diff failed", { maxStdoutBytes: MAX_STATUS_BYTES }),
		git(["diff", "--numstat", "-z"], root, "git diff failed", { maxStdoutBytes: MAX_STATUS_BYTES }),
	]);
	if (status.status === "rejected") return status;
	const parsed = parseStatus(status.stdout);
	// A conflicted path's counts would be of a combined diff, which says nothing a phone can use.
	const withCounts = (changes: GitFileChange[], output: GitOutput | Rejected) => {
		const byPath = output.status === "ok" ? parseNumstat(output.stdout) : new Map<string, LineCounts | undefined>();
		return changes
			.slice(0, limit)
			.map((change) => (change.change === "conflicted" ? change : { ...change, ...byPath.get(change.path) }));
	};
	const lists = [parsed.staged, parsed.unstaged, parsed.untracked];
	return {
		status: "accepted",
		root,
		...(parsed.branch !== undefined && { branch: parsed.branch }),
		...(parsed.head !== undefined && { head: parsed.head }),
		...(parsed.upstream !== undefined && { upstream: parsed.upstream }),
		staged: withCounts(parsed.staged, staged),
		unstaged: withCounts(parsed.unstaged, unstaged),
		untracked: parsed.untracked.slice(0, limit),
		truncated: status.cut || lists.some((list) => list.length > limit),
	};
}

/**
 * The working tree against the index, or the index against HEAD when `staged`, of one path or every path, with
 * at most `budget` characters of line text. The prefixes and quoting are set here, whatever the user's config.
 */
export async function gitDiff(
	root: string,
	query: { path?: string; staged?: boolean },
	budget: number,
): Promise<GitDiffResult> {
	if (query.path !== undefined && !isSafePathSpec(query.path)) {
		return rejected("invalid_input", `${query.path} is not a path inside the repository`);
	}
	const args = [
		...["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-relative"],
		...["--src-prefix=a/", "--dst-prefix=b/", "-M", ...(query.staged ? ["--cached"] : [])],
		...["--", ...(query.path === undefined ? [] : [query.path])],
	];
	// A diff line may be escaped wider than its text; four bytes a character covers any UTF-8.
	const out = await git(args, root, "git diff failed", { maxStdoutBytes: 4 * budget + 65_536 });
	if (out.status === "rejected") return out;
	const whole = out.cut ? out.stdout.slice(0, out.stdout.lastIndexOf("\n") + 1) : out.stdout;
	const parsed = parseDiff(whole, budget);
	return { status: "accepted", root, files: parsed.files, truncated: parsed.truncated || out.cut };
}

export async function gitBranches(root: string, limit: number): Promise<GitBranchesResult> {
	const out = await git(["for-each-ref", REF_FORMAT, "refs/heads", "refs/remotes"], root, "git for-each-ref failed");
	if (out.status === "rejected") return out;
	const branches = parseRefs(out.stdout);
	return { status: "accepted", branches: branches.slice(0, limit), truncated: branches.length > limit };
}

/** A branch with no commit yet has an empty history, which git reports as a failure. */
export async function gitLog(root: string, limit: number): Promise<GitLogResult> {
	const out = await git(["log", LOG_FORMAT, "-n", String(limit)], root, "git log failed");
	if (out.status === "ok") return { status: "accepted", commits: parseLog(out.stdout) };
	const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"], root, "");
	return head.status === "rejected" ? { status: "accepted", commits: [] } : out;
}
