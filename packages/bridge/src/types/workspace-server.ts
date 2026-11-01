import type { AgentStatusInfo, AgentType } from "./common";
import type { FileBinaryContent, FileContent, PtySession } from "./files";
import type {
	GitBranch,
	GitHubComment,
	GitHubIssue,
	GitHubPR,
	GitHubRemote,
	GitLogEntry,
	GitStatusResult,
} from "./git";
import type { VcsDiffFile } from "./session";

export type WorkspaceServerMessage =
	| { type: "vcs_diff"; data: VcsDiffFile[]; requestId?: string }
	| {
			type: "file_content";
			data: FileContent;
			path: string;
			requestId?: string;
	  }
	| {
			type: "file_binary";
			data: FileBinaryContent;
			path: string;
			requestId?: string;
	  }
	| {
			type: "file_too_large";
			data: { path: string; size: number; maxSize: number };
			requestId?: string;
	  }
	| { type: "files_and_dirs_found"; data: string[]; requestId?: string }
	| {
			type: "browse_result";
			data: { path: string; items: unknown[] };
			requestId?: string;
	  }
	| { type: "pty_list"; data: PtySession[]; requestId?: string }
	| { type: "pty_created"; data: PtySession; requestId?: string }
	| { type: "pty"; data: PtySession; requestId?: string }
	| { type: "pty_updated"; data: PtySession; requestId?: string }
	| { type: "pty_deleted"; data: boolean; ptyId: string; requestId?: string }
	| { type: "pty_connected"; data: { ptyId: string }; requestId?: string }
	| { type: "pty_disconnected"; data: { ptyId: string }; requestId?: string }
	| { type: "pty_output"; ptyId: string; data: string }
	| { type: "pty_error"; ptyId: string; error: string }
	| {
			type: "pty_health";
			ptyId: string;
			lastInputTime: number;
			lastOutputTime: number;
			bytesIn: number;
			bytesOut: number;
			isResponsive: boolean;
	  }
	| { type: "pty_exit"; ptyId: string; exitCode?: number }
	| {
			type: "git_diff";
			data: { path?: string; diff: string; staged?: boolean };
			requestId?: string;
	  }
	| { type: "git_status_result"; data: GitStatusResult; requestId?: string }
	| { type: "git_log_result"; data: GitLogEntry[]; requestId?: string }
	| { type: "git_branches_result"; data: GitBranch[]; requestId?: string }
	| { type: "git_staged"; data: { ok: boolean }; requestId?: string }
	| { type: "git_unstaged"; data: { ok: boolean }; requestId?: string }
	| { type: "git_reverted"; data: { ok: boolean }; requestId?: string }
	| {
			type: "git_committed";
			data: { hash: string; subject: string };
			requestId?: string;
	  }
	| { type: "git_pushed"; data: { ok: boolean }; requestId?: string }
	| { type: "git_pulled"; data: { ok: boolean }; requestId?: string }
	| { type: "git_fetched"; data: { ok: boolean }; requestId?: string }
	| { type: "git_checked_out"; data: { branch: string }; requestId?: string }
	| { type: "git_branch_created"; data: { name: string }; requestId?: string }
	| { type: "git_stashed"; data: { ok: boolean }; requestId?: string }
	| { type: "git_stash_popped"; data: { ok: boolean }; requestId?: string }
	| { type: "git_commit_diff_result"; data: string; requestId?: string }
	| {
			type: "github_remote_result";
			data: GitHubRemote | null;
			requestId?: string;
	  }
	| { type: "github_issues_result"; data: GitHubIssue[]; requestId?: string }
	| { type: "github_prs_result"; data: GitHubPR[]; requestId?: string }
	| { type: "github_pr_diff_result"; data: string; requestId?: string }
	| {
			type: "github_pr_comments_result";
			data: GitHubComment[];
			requestId?: string;
	  }
	| {
			type: "agents_status";
			data: Record<AgentType, AgentStatusInfo>;
			requestId?: string;
	  };
