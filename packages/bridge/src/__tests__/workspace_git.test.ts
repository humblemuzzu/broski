/**
 * The workspace git operations on a real repository in a temp directory: what they read, what they change,
 * and what they refuse before git sees it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBranches, gitCommitDiff, gitDiff, gitLog, gitStatus } from "../workspace/git/read";
import { gitReviewDiff } from "../workspace/git/review-diff";
import { gitCheckout, gitCommit, gitCreateBranch, gitRevertFile, gitStage, gitUnstage } from "../workspace/git/write";

let repo: string;

function git(...args: string[]): void {
	const result = Bun.spawnSync(["git", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

beforeAll(() => {
	repo = realpathSync(mkdtempSync(join(tmpdir(), "broski-git-")));
	git("init", "-q", "-b", "main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "a.txt"), "one\n");
	git("add", "a.txt");
	git("commit", "-q", "-m", "first");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe("reading a repository", () => {
	test("status, log and branches of a clean repository", async () => {
		expect(await gitStatus(repo)).toEqual({
			ok: true,
			value: { branch: "main", upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] },
		});
		const log = await gitLog(repo);
		expect(log.ok && log.value.map((entry) => entry.subject)).toEqual(["first"]);
		const branches = await gitBranches(repo);
		expect(branches.ok && branches.value).toEqual([
			{ name: "main", upstream: null, tracking: null, isCurrent: true, isRemote: false },
		]);
	});

	test("a path, a hash or a ref that could reach outside the repository or read as an option is refused", async () => {
		expect(await gitDiff(repo, { path: "../outside" })).toEqual({ ok: false, error: "Invalid path" });
		expect(await gitDiff(repo, { path: "--output=/tmp/x" })).toEqual({ ok: false, error: "Invalid path" });
		expect(await gitCommitDiff(repo, "HEAD~1")).toEqual({ ok: false, error: "Invalid commit hash" });
		expect(await gitCheckout(repo, "-b")).toEqual({ ok: false, error: "Invalid branch name" });
		expect(await gitCreateBranch(repo, "ok", "a..b")).toEqual({ ok: false, error: "Invalid start point" });
		expect(await gitCommit(repo, "  ")).toEqual({ ok: false, error: "Commit message cannot be empty" });
	});

	test("what git itself refuses is the error, never a throw", async () => {
		const missing = await gitCheckout(repo, "no-such-branch");
		expect(missing.ok).toBe(false);
		expect(!missing.ok && missing.error).toContain("no-such-branch");
	});
});

describe("changing a repository", () => {
	test("a change is seen, staged, unstaged, staged again and committed, and its patch read back", async () => {
		writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
		writeFileSync(join(repo, "b.txt"), "new\n");

		const before = await gitStatus(repo);
		expect(before.ok && before.value.unstaged).toEqual([{ path: "a.txt", status: "modified" }]);
		expect(before.ok && before.value.untracked).toEqual(["b.txt"]);
		const diff = await gitDiff(repo, { path: "a.txt" });
		expect(diff.ok && diff.value.diff).toContain("+two");

		expect(await gitStage(repo)).toEqual({ ok: true, value: null });
		expect(await gitUnstage(repo, "b.txt")).toEqual({ ok: true, value: null });
		const staged = await gitStatus(repo);
		expect(staged.ok && staged.value.staged).toEqual([{ path: "a.txt", status: "modified" }]);
		expect(staged.ok && staged.value.untracked).toEqual(["b.txt"]);
		const stagedDiff = await gitDiff(repo, { staged: true });
		expect(stagedDiff.ok && stagedDiff.value).toMatchObject({ staged: true });
		expect(stagedDiff.ok && stagedDiff.value.diff).toContain("+two");

		expect(await gitStage(repo, "b.txt")).toEqual({ ok: true, value: null });
		const committed = await gitCommit(repo, "second");
		expect(committed.ok && committed.value.subject).toBe("second");
		const patch = await gitCommitDiff(repo, committed.ok ? committed.value.hash : "");
		expect(patch.ok && patch.value).toContain("+new");
	});

	test("a working-tree change is reviewed with both sides of its text, then discarded", async () => {
		writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
		const review = await gitReviewDiff(repo, "git");
		expect(review).toEqual({
			ok: true,
			value: [
				{
					file: "a.txt",
					before: "one\ntwo\n",
					after: "one\ntwo\nthree\n",
					additions: 1,
					deletions: 0,
					status: "modified",
				},
			],
		});
		expect(await gitRevertFile(repo, "a.txt")).toEqual({ ok: true, value: null });
		const after = await gitStatus(repo);
		expect(after.ok && after.value.unstaged).toEqual([]);
	});

	test("a branch is created at HEAD and switched to, then left for the one before", async () => {
		expect(await gitCreateBranch(repo, "feature/x")).toEqual({ ok: true, value: { name: "feature/x" } });
		const on = await gitStatus(repo);
		expect(on.ok && on.value.branch).toBe("feature/x");
		expect(await gitCheckout(repo, "main")).toEqual({ ok: true, value: { branch: "main" } });
		const branches = await gitBranches(repo);
		expect(branches.ok && branches.value.map((branch) => [branch.name, branch.isCurrent])).toEqual([
			["feature/x", false],
			["main", true],
		]);
	});
});
