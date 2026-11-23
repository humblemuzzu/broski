import { z } from "zod";
import { Timestamp } from "./ids";
import {
	MAX_DIFF_LINES,
	MAX_GIT_ENTRIES,
	MAX_ID_CHARS,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
} from "./limits";
import { MAX_PAGE_LIMIT, PageCursor } from "./paging";
import { Rejected } from "./rejection";
import { WorkingDirectory } from "./sessions";
import { FilePath } from "./workspace-files";

/** `conflicted`: an unmerged path, listed with the unstaged changes. */
export const GitChange = z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed", "conflicted"]);
export type GitChange = z.infer<typeof GitChange>;

/** Paths are relative to the repository's root. The line counts are absent for a binary file. */
export const GitFileChange = z.strictObject({
	path: FilePath,
	previousPath: FilePath.optional(),
	change: GitChange,
	additions: z.int().nonnegative().optional(),
	deletions: z.int().nonnegative().optional(),
});
export type GitFileChange = z.infer<typeof GitFileChange>;

export const GitUpstream = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	ahead: z.int().nonnegative(),
	behind: z.int().nonnegative(),
});
export type GitUpstream = z.infer<typeof GitUpstream>;

/**
 * `root`: the repository's top directory, canonical, which every path in a git answer is relative to.
 * `branch` is absent on a detached HEAD, `head` before the first commit. `truncated`: a list was cut
 * at its bound.
 */
export const GitStatusRead = z.strictObject({
	status: z.literal("accepted"),
	root: WorkingDirectory,
	branch: z.string().min(1).max(MAX_NAME_CHARS).optional(),
	head: z.string().min(1).max(MAX_ID_CHARS).optional(),
	upstream: GitUpstream.optional(),
	staged: z.array(GitFileChange).max(MAX_GIT_ENTRIES),
	unstaged: z.array(GitFileChange).max(MAX_GIT_ENTRIES),
	untracked: z.array(FilePath).max(MAX_GIT_ENTRIES),
	truncated: z.boolean(),
});
export type GitStatusRead = z.infer<typeof GitStatusRead>;

export const GitStatusResult = z.discriminatedUnion("status", [GitStatusRead, Rejected]);
export type GitStatusResult = z.infer<typeof GitStatusResult>;

export const GitDiffLineKind = z.enum(["context", "added", "removed"]);
export type GitDiffLineKind = z.infer<typeof GitDiffLineKind>;

/** `noNewline`: the file ends after this line without a newline. */
export const GitDiffLine = z.strictObject({
	kind: GitDiffLineKind,
	text: z.string().max(MAX_TEXT_CHARS),
	oldLine: z.int().positive().optional(),
	newLine: z.int().positive().optional(),
	noNewline: z.boolean().optional(),
});
export type GitDiffLine = z.infer<typeof GitDiffLine>;

/** `header`: the context git names after the `@@` range, such as the enclosing function. */
export const GitDiffHunk = z.strictObject({
	oldStart: z.int().nonnegative(),
	oldLines: z.int().nonnegative(),
	newStart: z.int().nonnegative(),
	newLines: z.int().nonnegative(),
	header: z.string().max(MAX_NAME_CHARS).optional(),
	lines: z.array(GitDiffLine).max(MAX_DIFF_LINES),
});
export type GitDiffHunk = z.infer<typeof GitDiffHunk>;

export const GitDiffFile = z.strictObject({
	path: FilePath,
	previousPath: FilePath.optional(),
	change: GitChange,
	binary: z.boolean(),
	hunks: z.array(GitDiffHunk).max(MAX_DIFF_LINES),
});
export type GitDiffFile = z.infer<typeof GitDiffFile>;

/** `truncated`: the diff goes on past what this answer could carry; the files and hunks shown are cut there. */
export const GitDiffRead = z.strictObject({
	status: z.literal("accepted"),
	root: WorkingDirectory,
	files: z.array(GitDiffFile).max(MAX_LIST_ITEMS),
	truncated: z.boolean(),
});
export type GitDiffRead = z.infer<typeof GitDiffRead>;

export const GitDiffResult = z.discriminatedUnion("status", [GitDiffRead, Rejected]);
export type GitDiffResult = z.infer<typeof GitDiffResult>;

/** A remote branch is named with its remote, `origin/main`. */
export const GitBranch = z.strictObject({
	name: z.string().min(1).max(MAX_NAME_CHARS),
	remote: z.boolean(),
	current: z.boolean(),
	upstream: GitUpstream.optional(),
});
export type GitBranch = z.infer<typeof GitBranch>;

/** Local branches first, each group by name. */
export const GitBranchesListed = z.strictObject({
	status: z.literal("accepted"),
	branches: z.array(GitBranch).max(MAX_GIT_ENTRIES),
	truncated: z.boolean(),
});
export type GitBranchesListed = z.infer<typeof GitBranchesListed>;

export const GitBranchesResult = z.discriminatedUnion("status", [GitBranchesListed, Rejected]);
export type GitBranchesResult = z.infer<typeof GitBranchesResult>;

export const GitCommit = z.strictObject({
	hash: z.string().min(1).max(MAX_ID_CHARS),
	subject: z.string().max(MAX_TEXT_CHARS),
	author: z.string().max(MAX_NAME_CHARS),
	authoredAt: Timestamp,
});
export type GitCommit = z.infer<typeof GitCommit>;

/** The current branch's commits, newest first; `nextCursor` reads on from the same head, absent at the root. */
export const GitLogRead = z.strictObject({
	status: z.literal("accepted"),
	commits: z.array(GitCommit).max(MAX_PAGE_LIMIT),
	nextCursor: PageCursor.optional(),
});
export type GitLogRead = z.infer<typeof GitLogRead>;

export const GitLogResult = z.discriminatedUnion("status", [GitLogRead, Rejected]);
export type GitLogResult = z.infer<typeof GitLogResult>;

export const GitCommitted = z.strictObject({ status: z.literal("accepted"), commit: GitCommit });
export type GitCommitted = z.infer<typeof GitCommitted>;

export const GitCommitResult = z.discriminatedUnion("status", [GitCommitted, Rejected]);
export type GitCommitResult = z.infer<typeof GitCommitResult>;

export const GitCheckedOut = z.strictObject({
	status: z.literal("accepted"),
	branch: z.string().min(1).max(MAX_NAME_CHARS),
});
export type GitCheckedOut = z.infer<typeof GitCheckedOut>;

export const GitCheckoutResult = z.discriminatedUnion("status", [GitCheckedOut, Rejected]);
export type GitCheckoutResult = z.infer<typeof GitCheckoutResult>;
