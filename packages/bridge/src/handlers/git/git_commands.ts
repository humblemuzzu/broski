import { ensureGitSuccess, runGit } from "./command";
import { parseGitBranches, parseGitLog, parseGitStatus } from "./parse";
import {
	clamp,
	isSafeBranchName,
	isSafeHash,
	isSafePathSpec,
	isSafeRef,
	parsePositiveInt,
	sanitizeCommitMessage,
} from "./security";
import type { GitHandlerContext, GitReply } from "./types";
import { ensureSecureCwd, errorReply } from "./util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

export async function handleGitCommand(message: any, reply: GitReply, ctx: GitHandlerContext): Promise<boolean> {
	const requestId = typeof message?.requestId === "string" ? message.requestId : undefined;

	switch (message.type) {
		case "git_diff": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const rawPath = ctx.safeString(message.path).trim();
			const staged = message.staged === true;

			if (rawPath && !isSafePathSpec(rawPath)) {
				errorReply(reply, "Invalid path", requestId);
				break;
			}

			const args: string[] = ["diff"];
			if (staged) args.push("--staged");
			args.push("--");
			if (rawPath) args.push(rawPath);

			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git diff failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_diff",
				data: { path: rawPath || undefined, diff: result.stdout, staged },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_status": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const result = await runGit(["status", "--porcelain=v2", "--branch", "--untracked-files=all"], secureCwd);
			const err = ensureGitSuccess(result, "git status failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_status_result",
				data: parseGitStatus(result.stdout),
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_log": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const limit = clamp(parsePositiveInt(message.limit, 50), 1, 200);
			const result = await runGit(
				["log", `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e`, "-n", String(limit)],
				secureCwd,
			);
			const err = ensureGitSuccess(result, "git log failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_log_result",
				data: parseGitLog(result.stdout),
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_branches": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const result = await runGit(
				["branch", "-a", "--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(HEAD)"],
				secureCwd,
			);
			const err = ensureGitSuccess(result, "git branch failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_branches_result",
				data: parseGitBranches(result.stdout),
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_stage": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const path = ctx.safeString(message.path).trim();
			if (path && !isSafePathSpec(path)) {
				errorReply(reply, "Invalid path", requestId);
				break;
			}

			const args = path ? ["add", "--", path] : ["add", "-A"];
			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git add failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_staged",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_unstage": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const path = ctx.safeString(message.path).trim();
			if (path && !isSafePathSpec(path)) {
				errorReply(reply, "Invalid path", requestId);
				break;
			}

			const args = path ? ["restore", "--staged", "--", path] : ["reset", "HEAD"];
			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git unstage failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_unstaged",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_revert_file": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const path = ctx.safeString(message.path).trim();
			if (!path || !isSafePathSpec(path)) {
				errorReply(reply, "Invalid path", requestId);
				break;
			}

			const result = await runGit(["restore", "--worktree", "--", path], secureCwd);
			const err = ensureGitSuccess(result, "git restore failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_reverted",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_commit": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const rawMessage = sanitizeCommitMessage(ctx.safeString(message.message));
			if (!rawMessage.trim()) {
				errorReply(reply, "Commit message cannot be empty", requestId);
				break;
			}

			const result = await runGit(["commit", "-m", rawMessage], secureCwd);
			const err = ensureGitSuccess(result, "git commit failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			const latest = await runGit(["log", "-1", "--format=%H%x1f%s"], secureCwd);
			const latestErr = ensureGitSuccess(latest, "Failed to read latest commit");
			if (latestErr) {
				errorReply(reply, latestErr, requestId);
				break;
			}

			const [hash = "", subject = ""] = latest.stdout.trim().split("\x1f");
			reply({
				type: "git_committed",
				data: { hash, subject },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_push": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const force = message.force === true;
			const args = force ? ["push", "--force-with-lease"] : ["push"];
			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git push failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_pushed",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_pull": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const rebase = message.rebase !== false;
			const args = rebase ? ["pull", "--rebase"] : ["pull", "--no-rebase"];
			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git pull failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_pulled",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_fetch": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const result = await runGit(["fetch", "--all", "--prune"], secureCwd);
			const err = ensureGitSuccess(result, "git fetch failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_fetched",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_checkout": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const branch = ctx.safeString(message.branch).trim();
			if (!isSafeBranchName(branch)) {
				errorReply(reply, "Invalid branch name", requestId);
				break;
			}

			const result = await runGit(["switch", branch], secureCwd);
			const err = ensureGitSuccess(result, "git switch failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_checked_out",
				data: { branch },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_create_branch": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const name = ctx.safeString(message.name).trim();
			const startPoint = ctx.safeString(message.startPoint).trim();
			if (!isSafeBranchName(name)) {
				errorReply(reply, "Invalid branch name", requestId);
				break;
			}
			if (startPoint && !isSafeRef(startPoint)) {
				errorReply(reply, "Invalid start point", requestId);
				break;
			}

			const args = ["switch", "-c", name];
			if (startPoint) args.push(startPoint);
			const result = await runGit(args, secureCwd);
			const err = ensureGitSuccess(result, "git branch create failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_branch_created",
				data: { name },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_stash": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const result = await runGit(["stash", "push", "-u"], secureCwd);
			const err = ensureGitSuccess(result, "git stash failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_stashed",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_stash_pop": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const result = await runGit(["stash", "pop"], secureCwd);
			const err = ensureGitSuccess(result, "git stash pop failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_stash_popped",
				data: { ok: true },
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_commit_diff": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const hash = ctx.safeString(message.hash).trim().toLowerCase();
			if (!isSafeHash(hash)) {
				errorReply(reply, "Invalid commit hash", requestId);
				break;
			}

			const result = await runGit(["show", hash, "--format=", "--patch"], secureCwd);
			const err = ensureGitSuccess(result, "git show failed");
			if (err) {
				errorReply(reply, err, requestId);
				break;
			}

			reply({
				type: "git_commit_diff_result",
				data: result.stdout,
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		case "git_review_diff": {
			const secureCwd = await ensureSecureCwd(message, ctx);
			if (!secureCwd) {
				errorReply(reply, "Access denied", requestId);
				break;
			}

			const mode = ctx.safeString(message.mode).trim();
			if (mode !== "git" && mode !== "branch") {
				errorReply(reply, "Invalid mode: must be 'git' or 'branch'", requestId);
				break;
			}

			let defaultBranch = "";
			if (mode === "branch") {
				// Detect default branch: try origin/HEAD, fallback to main/master
				const symRef = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], secureCwd);
				if (symRef.exitCode === 0 && symRef.stdout.trim()) {
					// e.g. "origin/main" → "main"
					defaultBranch = symRef.stdout.trim().replace(/^origin\//, "");
				} else {
					// Fallback: check if main or master exists
					const mainCheck = await runGit(["rev-parse", "--verify", "main"], secureCwd);
					if (mainCheck.exitCode === 0) {
						defaultBranch = "main";
					} else {
						const masterCheck = await runGit(["rev-parse", "--verify", "master"], secureCwd);
						if (masterCheck.exitCode === 0) {
							defaultBranch = "master";
						} else {
							errorReply(reply, "Could not determine default branch", requestId);
							break;
						}
					}
				}
			}

			// Get file list with stats
			const diffArgs = mode === "git"
				? ["diff", "--numstat", "--diff-filter=ACDMR", "-z"]
				: ["diff", "--numstat", "--diff-filter=ACDMR", "-z", `${defaultBranch}...HEAD`];

			let numstatResult = await runGit(diffArgs, secureCwd);
			if (numstatResult.exitCode !== 0) {
				// If branch mode fails (no common ancestor), try two-dot diff
				if (mode === "branch") {
					const fallbackArgs = ["diff", "--numstat", "--diff-filter=ACDMR", "-z", `${defaultBranch}..HEAD`];
					numstatResult = await runGit(fallbackArgs, secureCwd);
					if (numstatResult.exitCode !== 0) {
						errorReply(reply, "git diff failed", requestId);
						break;
					}
				} else {
					errorReply(reply, "git diff failed", requestId);
					break;
				}
			}

			// Also get the diff-filter status for each file
			const statusArgs = mode === "git"
				? ["diff", "--name-status", "--diff-filter=ACDMR"]
				: ["diff", "--name-status", "--diff-filter=ACDMR", `${defaultBranch}...HEAD`];
			const statusResult = await runGit(statusArgs, secureCwd);

			// Parse name-status into a map: file → status
			const statusMap = new Map<string, string>();
			if (statusResult.exitCode === 0) {
				for (const line of statusResult.stdout.trim().split("\n")) {
					if (!line) continue;
					const parts = line.split("\t");
					if (parts.length >= 2) {
						const s = parts[0].charAt(0); // A, D, M, R, C
						const file = parts[parts.length - 1]; // last part (handles renames)
						const status = s === "A" ? "added" : s === "D" ? "deleted" : "modified";
						statusMap.set(file, status);
					}
				}
			}

			// Parse numstat: "additions\tdeletions\tfilename" (NUL-separated with -z)
			const files: Array<{
				file: string;
				before: string;
				after: string;
				additions: number;
				deletions: number;
				status?: string;
			}> = [];

			const numstatLines = numstatResult.stdout.split("\0").filter(Boolean);
			for (const entry of numstatLines) {
				const parts = entry.split("\t");
				if (parts.length < 3) continue;
				const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
				const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
				const file = parts.slice(2).join("\t"); // rejoin in case filename has tabs
				if (!file || !isSafePathSpec(file)) continue;

				const status = statusMap.get(file) || "modified";

				// Get before/after content for each file (limit to prevent huge payloads)
				let before = "";
				let after = "";

				try {
					if (status !== "added") {
						const ref = mode === "git" ? "HEAD" : defaultBranch;
						const showResult = await runGit(["show", `${ref}:${file}`], secureCwd);
						if (showResult.exitCode === 0) {
							before = showResult.stdout.slice(0, 100_000); // cap at 100KB
						}
					}
					if (status !== "deleted") {
						if (mode === "git") {
							// Working tree: read file directly
							const fullPath = resolve(secureCwd, file);
							// Security: ensure resolved path is under secureCwd
							if (fullPath.startsWith(resolve(secureCwd))) {
								after = (await readFile(fullPath, "utf-8")).slice(0, 100_000);
							}
						} else {
							// Branch mode: HEAD version
							const showResult = await runGit(["show", `HEAD:${file}`], secureCwd);
							if (showResult.exitCode === 0) {
								after = showResult.stdout.slice(0, 100_000);
							}
						}
					}
				} catch {
					// Binary files or read errors — leave before/after empty
				}

				files.push({ file, before, after, additions, deletions, status });
			}

			reply({
				type: "vcs_diff",
				data: files,
				...(requestId ? { requestId } : {}),
			});
			break;
		}

		default:
			return false;
	}

	return true;
}
