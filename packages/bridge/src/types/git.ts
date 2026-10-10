// Feature 18: File Status (Git)
export type FileStatusInfo = {
	path: string;
	added: number;
	removed: number;
	status: "modified" | "added" | "deleted";
};

export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "copied";

export type GitFileChange = {
	path: string;
	status: GitChangeStatus;
	oldPath?: string;
	additions?: number;
	deletions?: number;
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

export type GitHubRemote = {
	owner: string;
	repo: string;
	host: string;
};

export type GitHubIssue = {
	number: number;
	title: string;
	state: string;
	author: string;
	createdAt: string;
	labels: string[];
	body?: string;
};

export type GitHubPR = {
	number: number;
	title: string;
	state: string;
	author: string;
	headBranch: string;
	baseBranch: string;
	createdAt: string;
	isDraft: boolean;
	isMerged: boolean;
};

export type GitHubComment = {
	author: string;
	body: string;
	path?: string;
	line?: number;
	createdAt: string;
};
