export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "copied";

export type GitFileChange = {
	path: string;
	status: GitChangeStatus;
	oldPath?: string;
};

export type GitStatusResult = {
	branch: string;
	upstream: string | null;
	ahead: number;
	behind: number;
	staged: GitFileChange[];
	unstaged: GitFileChange[];
	untracked: string[];
};

export type GitLogEntry = {
	hash: string;
	shortHash: string;
	author: string;
	email: string;
	timestamp: number;
	subject: string;
};

export type GitBranch = {
	name: string;
	upstream: string | null;
	tracking: string | null;
	isCurrent: boolean;
	isRemote: boolean;
};

export type GitDiff = {
	path?: string;
	diff: string;
	staged: boolean;
};

export type GitCommitted = {
	hash: string;
	subject: string;
};

/** One changed file of a review, with both sides of its text (each cut at `REVIEW_TEXT_MAX_CHARS`). */
export type GitReviewFile = {
	file: string;
	before: string;
	after: string;
	additions: number;
	deletions: number;
	status: "added" | "deleted" | "modified";
};

/** `git`: the working tree against HEAD; `branch`: HEAD against the default branch. */
export type GitReviewMode = "git" | "branch";

export type CommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
};

/** Every operation answers a value: what git refused or what the input broke is the error, never a throw. */
export type GitResult<T> = { ok: true; value: T } | { ok: false; error: string };
