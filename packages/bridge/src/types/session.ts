import type { PermissionRuleset } from "./common";

export type ProjectSummary = {
	id: string;
	name: string;
	path: string;
	lastOpened?: number;
	icon?: string;
};

export type SessionSummary = {
	id: string;
	slug?: string; // URL-friendly slug (SDK v1.1.53+)
	title: string;
	projectID: string;
	workspaceID?: string; // Workspace association (SDK v1.2.15+)
	directory: string;
	parentID?: string; // For forked sessions
	time: {
		created: number;
		updated: number;
		compacting?: number;
		archived?: number;
	};
	summary?: {
		additions: number;
		deletions: number;
		files: number;
		diffs?: Array<{
			file: string;
			before: string;
			after: string;
			additions: number;
			deletions: number;
			status?: "added" | "deleted" | "modified";
		}>;
	};
	share?: {
		// Feature 8: Session sharing info
		url: string;
	};
	revert?: {
		messageID: string;
		partID?: string;
		snapshot?: string;
		diff?: string;
	};
	permission?: PermissionRuleset; // Session-level permissions (SDK v1.1.53+)
	project?: {
		id: string;
		name?: string;
		worktree: string;
	};
};

// VCS/Git information from OpenCode SDK
export type VcsInfo = {
	branch?: string;
	default_branch?: string;
};

// VCS diff file from OpenCode SDK vcs.diff() endpoint
export type VcsDiffFile = {
	file: string;
	before: string;
	after: string;
	additions: number;
	deletions: number;
	status?: "added" | "deleted" | "modified";
};
// LSP server status from OpenCode SDK
export type LspServerStatus = {
	id: string;
	name: string;
	language?: string;
	status: "running" | "stopped" | "error";
	root?: string;
};

// Session context info (tokens, cost, etc.) computed from messages
export type SessionContextInfo = {
	tokens: {
		input: number;
		output: number;
		total: number;
		contextTokens?: number; // Tokens actually occupying the context window (input + cache)
		contextWindow: number; // Model's max context
		reasoning?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	cost: number;
	lsp: LspServerStatus[];
	modifiedFiles: Array<{
		file: string;
		additions: number;
		deletions: number;
	}>;
};
