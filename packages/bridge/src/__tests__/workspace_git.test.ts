/**
 * Git over the contract: the core with the real workspace host, driving the real git on repositories in the
 * temp directory, with the production path policy in front.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type GitDiffLine, MAX_DIFF_LINES, MAX_TEXT_CHARS } from "../contract";
import type { CoreRig, TestClient } from "./helpers/core-rig";
import { accepted, rejectionCode, startWorkspaceRig, tempDirectory } from "./helpers/workspace-rig";

const dirs: string[] = [];
let rig: CoreRig;
let phone: TestClient;

function run(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
	return result.stdout.toString();
}

/** A repository with one commit of `a.txt`, its identity set locally. */
function repository(name: string): string {
	const repo = tempDirectory(`broski-git-${name}-`);
	dirs.push(repo);
	run(repo, "init", "-q", "-b", "main");
	run(repo, "config", "user.email", "test@example.com");
	run(repo, "config", "user.name", "Test");
	run(repo, "config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "a.txt"), "one\n");
	run(repo, "add", "a.txt");
	run(repo, "commit", "-q", "-m", "first");
	return repo;
}

beforeAll(async () => {
	rig = await startWorkspaceRig();
	phone = await rig.client("phone");
});

afterAll(async () => {
	await rig.core.dispose();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const status = async (cwd: string) => (await phone.ok("git.status", { cwd })).result;
const diff = async (cwd: string, extra: { path?: string; staged?: boolean } = {}) =>
	(await phone.ok("git.diff", { cwd, ...extra })).result;
const stage = async (cwd: string, paths: string[]) => (await phone.ok("git.stage", { cwd, paths })).result;
const commit = async (cwd: string, message: string) => (await phone.ok("git.commit", { cwd, message })).result;
const checkout = async (cwd: string, branch: string) => (await phone.ok("git.checkout", { cwd, branch })).result;

function lineSummary(lines: GitDiffLine[]): string[] {
	return lines.map((line) => `${line.kind}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}:${line.text}`);
}

describe("reading a repository", () => {
	test("its status names the top directory, the branch and head, from any directory inside it", async () => {
		const repo = repository("clean");
		mkdirSync(join(repo, "sub"));
		const head = run(repo, "rev-parse", "HEAD").trim();
		expect(accepted(await status(join(repo, "sub")))).toEqual({
			status: "accepted",
			root: repo,
			branch: "main",
			head,
			staged: [],
			unstaged: [],
			untracked: [],
			truncated: false,
		});
		const log = accepted((await phone.ok("git.log", { cwd: repo })).result);
		expect(log.commits).toHaveLength(1);
		expect(log.commits[0]).toMatchObject({ hash: head, subject: "first", author: "Test" });
		expect(log.commits[0]?.authoredAt).toBeGreaterThan(1_600_000_000_000);
	});

	test("before the first commit there is no head and no history", async () => {
		const repo = tempDirectory("broski-git-unborn-");
		dirs.push(repo);
		run(repo, "init", "-q", "-b", "main");
		writeFileSync(join(repo, "x.txt"), "x\n");
		const unborn = accepted(await status(repo));
		expect(unborn.head).toBeUndefined();
		expect(unborn.branch).toBe("main");
		expect(unborn.untracked).toEqual(["x.txt"]);
		expect(accepted((await phone.ok("git.log", { cwd: repo })).result).commits).toEqual([]);
		accepted(await stage(repo, ["x.txt"]));
		expect(accepted(await status(repo)).staged).toEqual([
			{ path: "x.txt", change: "added", additions: 1, deletions: 0 },
		]);
		accepted((await phone.ok("git.unstage", { cwd: repo, paths: ["x.txt"] })).result);
		expect(accepted(await status(repo)).untracked).toEqual(["x.txt"]);
	});
});

describe("changing a repository", () => {
	test("a change is listed with its line counts, staged, unstaged, and committed", async () => {
		const repo = repository("change");
		writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
		writeFileSync(join(repo, "new file.txt"), "fresh\n");
		const changed = accepted(await status(repo));
		expect(changed.unstaged).toEqual([{ path: "a.txt", change: "modified", additions: 1, deletions: 0 }]);
		expect(changed.untracked).toEqual(["new file.txt"]);

		accepted(await stage(repo, ["a.txt", "new file.txt"]));
		expect(accepted(await status(repo)).staged).toEqual([
			{ path: "a.txt", change: "modified", additions: 1, deletions: 0 },
			{ path: "new file.txt", change: "added", additions: 1, deletions: 0 },
		]);
		accepted((await phone.ok("git.unstage", { cwd: repo, paths: ["new file.txt"] })).result);
		expect(accepted(await status(repo)).untracked).toEqual(["new file.txt"]);

		const committed = accepted(await commit(repo, "second\n\nwith a body"));
		expect(committed.commit).toMatchObject({ subject: "second", author: "Test" });
		expect(committed.commit.hash).toBe(run(repo, "rev-parse", "HEAD").trim());
		const after = accepted(await status(repo));
		expect([after.staged, after.unstaged, after.untracked]).toEqual([[], [], ["new file.txt"]]);
		const log = accepted((await phone.ok("git.log", { cwd: repo, limit: 1 })).result);
		expect(log.commits.map((entry) => entry.subject)).toEqual(["second"]);
	});

	test("a rename names the path it came from, and a binary file has no line counts", async () => {
		const repo = repository("rename");
		writeFileSync(join(repo, "blob.bin"), Uint8Array.from([0, 1, 2]));
		run(repo, "add", "blob.bin");
		run(repo, "commit", "-q", "-m", "blob");
		run(repo, "mv", "a.txt", "renamed a.txt");
		writeFileSync(join(repo, "blob.bin"), Uint8Array.from([0, 3, 4]));
		accepted(await stage(repo, ["blob.bin"]));
		const staged = accepted(await status(repo)).staged;
		expect(staged).toContainEqual({ path: "blob.bin", change: "modified" });
		expect(staged).toContainEqual({
			path: "renamed a.txt",
			previousPath: "a.txt",
			change: "renamed",
			additions: 0,
			deletions: 0,
		});
		const files = accepted(await diff(repo, { staged: true })).files;
		expect(files).toContainEqual({ path: "blob.bin", change: "modified", binary: true, hunks: [] });
		expect(files).toContainEqual({
			path: "renamed a.txt",
			previousPath: "a.txt",
			change: "renamed",
			binary: false,
			hunks: [],
		});
	});
});

describe("a diff", () => {
	test("is files of hunks of lines, each numbered on the side it belongs to", async () => {
		const repo = repository("diff");
		const ten = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);
		writeFileSync(join(repo, 'q"uote d.txt'), `${ten.join("\n")}\n`);
		run(repo, "add", ".");
		run(repo, "commit", "-q", "-m", "ten");
		const changed = [...ten];
		changed[4] = "line five";
		writeFileSync(join(repo, 'q"uote d.txt'), `${changed.join("\n")}\nend`);
		writeFileSync(join(repo, "a.txt"), "uno\n");
		accepted(await stage(repo, ["a.txt"]));

		const unstaged = accepted(await diff(repo, { path: 'q"uote d.txt' }));
		expect(unstaged.root).toBe(repo);
		expect(unstaged.truncated).toBe(false);
		expect(unstaged.files).toHaveLength(1);
		const [file] = unstaged.files;
		expect(file).toMatchObject({ path: 'q"uote d.txt', change: "modified", binary: false });
		expect(file?.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines])).toEqual([
			[2, 9, 2, 10],
		]);
		expect(lineSummary(file?.hunks[0]?.lines ?? [])).toEqual([
			"context:2:2:line 2",
			"context:3:3:line 3",
			"context:4:4:line 4",
			"removed:5:-:line 5",
			"added:-:5:line five",
			"context:6:6:line 6",
			"context:7:7:line 7",
			"context:8:8:line 8",
			"context:9:9:line 9",
			"context:10:10:line 10",
			"added:-:11:end",
		]);
		expect(file?.hunks[0]?.lines.at(-1)?.noNewline).toBe(true);

		const staged = accepted(await diff(repo, { staged: true }));
		expect(staged.files.map((entry) => entry.path)).toEqual(["a.txt"]);
		expect(lineSummary(staged.files[0]?.hunks[0]?.lines ?? [])).toEqual(["removed:1:-:one", "added:-:1:uno"]);
	});

	test("longer than an answer carries is cut at a whole line, and says so", async () => {
		const repo = repository("long");
		const lines = Array.from({ length: MAX_DIFF_LINES + 5_000 }, (_, index) => `${index}`);
		writeFileSync(join(repo, "many.txt"), `${lines.join("\n")}\n`);
		run(repo, "add", "many.txt");
		const byCount = accepted(await diff(repo, { staged: true }));
		expect(byCount.truncated).toBe(true);
		const shown = byCount.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
		expect(shown).toHaveLength(MAX_DIFF_LINES);
		expect(shown.at(-1)?.text).toBe(String(MAX_DIFF_LINES - 1));

		run(repo, "reset", "-q", "many.txt");
		const wide = Array.from({ length: 1_500 }, (_, index) => `${index}`.padEnd(1_000, "x"));
		writeFileSync(join(repo, "wide.txt"), `${wide.join("\n")}\n`);
		run(repo, "add", "wide.txt");
		const byText = accepted(await diff(repo, { staged: true }));
		const text = byText.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines)).map((line) => line.text);
		expect(byText.truncated).toBe(true);
		expect(text.length).toBe(Math.floor(MAX_TEXT_CHARS / 1_000));
		expect(text.every((line, index) => line === wide[index])).toBe(true);
	});
});

describe("what git refuses", () => {
	test("nothing to commit, an empty message, a dirty switch and an unknown branch are refused in git's own words", async () => {
		const repo = repository("refuse");
		const nothing = await commit(repo, "nothing");
		expect(rejectionCode(nothing)).toBe("invalid_input");
		expect(JSON.stringify(nothing)).toContain("nothing to commit");
		expect(rejectionCode(await commit(repo, "  \n"))).toBe("invalid_input");

		run(repo, "switch", "-q", "-c", "other");
		writeFileSync(join(repo, "a.txt"), "other\n");
		run(repo, "commit", "-q", "-am", "other");
		run(repo, "switch", "-q", "main");
		writeFileSync(join(repo, "a.txt"), "local edit\n");
		const dirty = await checkout(repo, "other");
		expect(rejectionCode(dirty)).toBe("invalid_input");
		expect(JSON.stringify(dirty)).toContain("would be overwritten");
		expect(rejectionCode(await checkout(repo, "no-such-branch"))).toBe("invalid_input");
		expect(rejectionCode(await checkout(repo, "-f"))).toBe("invalid_input");
		expect(accepted(await status(repo)).branch).toBe("main");
	});

	test("a merge conflict shows as conflicted, in the status and the diff, and cannot be committed", async () => {
		const repo = repository("conflict");
		run(repo, "switch", "-q", "-c", "theirs");
		writeFileSync(join(repo, "a.txt"), "theirs\n");
		run(repo, "commit", "-q", "-am", "theirs");
		run(repo, "switch", "-q", "main");
		writeFileSync(join(repo, "a.txt"), "ours\n");
		run(repo, "commit", "-q", "-am", "ours");
		Bun.spawnSync(["git", "merge", "theirs"], { cwd: repo, stdout: "pipe", stderr: "pipe" });

		expect(accepted(await status(repo)).unstaged).toEqual([{ path: "a.txt", change: "conflicted" }]);
		expect(accepted(await diff(repo)).files).toEqual([
			{ path: "a.txt", change: "conflicted", binary: false, hunks: [] },
		]);
		const refused = await commit(repo, "merge");
		expect(rejectionCode(refused)).toBe("invalid_input");
		expect(JSON.stringify(refused)).toContain("unmerged");
	});
});

describe("branches", () => {
	test("are listed local first with the current one marked, and a remote one's name makes a branch that tracks it", async () => {
		const repo = repository("branches");
		const origin = tempDirectory("broski-git-origin-");
		dirs.push(origin);
		run(origin, "init", "-q", "--bare");
		run(repo, "remote", "add", "origin", origin);
		run(repo, "push", "-q", "origin", "main");
		run(repo, "switch", "-q", "-c", "feature");
		writeFileSync(join(repo, "f.txt"), "f\n");
		run(repo, "add", "f.txt");
		run(repo, "commit", "-q", "-m", "feature");
		run(repo, "push", "-q", "origin", "feature");
		run(repo, "switch", "-q", "main");
		run(repo, "branch", "-q", "-D", "feature");
		run(repo, "branch", "-q", "--set-upstream-to", "origin/main");
		writeFileSync(join(repo, "a.txt"), "ahead\n");
		run(repo, "commit", "-q", "-am", "ahead");

		const listed = accepted((await phone.ok("git.branches", { cwd: repo })).result);
		expect(listed).toEqual({
			status: "accepted",
			branches: [
				{ name: "main", remote: false, current: true, upstream: { name: "origin/main", ahead: 1, behind: 0 } },
				{ name: "origin/feature", remote: true, current: false },
				{ name: "origin/main", remote: true, current: false },
			],
			truncated: false,
		});
		expect(accepted(await status(repo)).upstream).toEqual({ name: "origin/main", ahead: 1, behind: 0 });

		expect(accepted(await checkout(repo, "feature"))).toEqual({ status: "accepted", branch: "feature" });
		const after = accepted((await phone.ok("git.branches", { cwd: repo })).result);
		expect(after.branches[0]).toEqual({
			name: "feature",
			remote: false,
			current: true,
			upstream: { name: "origin/feature", ahead: 0, behind: 0 },
		});
	});
});

describe("the path policy and git's own checks", () => {
	test("refuse a directory outside the served folders, one outside any repository, and paths that leave it", async () => {
		const repo = repository("policy");
		const plain = tempDirectory("broski-git-plain-");
		dirs.push(plain);
		expect(rejectionCode(await status("/etc"))).toBe("forbidden");
		expect(rejectionCode(await status(plain))).toBe("not_found");
		expect(rejectionCode(await status(join(repo, "a.txt")))).toBe("invalid_input");
		expect(rejectionCode(await stage(repo, ["../outside"]))).toBe("invalid_input");
		expect(rejectionCode(await stage(repo, ["/etc/hosts"]))).toBe("invalid_input");
		expect(rejectionCode(await stage(repo, ["--all"]))).toBe("invalid_input");
		expect(rejectionCode(await diff(repo, { path: "../x" }))).toBe("invalid_input");
		writeFileSync(join(repo, "*"), "a file named star\n");
		writeFileSync(join(repo, "b.txt"), "b\n");
		accepted(await stage(repo, ["*"]));
		expect(accepted(await status(repo)).staged.map((change) => change.path)).toEqual(["*"]);
	});
});
