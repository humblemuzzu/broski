import type { AgentStatusInfo, AgentType } from "./common";
import type {
	FileBinaryContent,
	FileContent,
	PtySession,
	SessionStatusInfo,
	SymbolResult,
	TextSearchResult,
} from "./files";
import type {
	FileStatusInfo,
	GitBranch,
	GitHubComment,
	GitHubIssue,
	GitHubPR,
	GitHubRemote,
	GitLogEntry,
	GitStatusResult,
} from "./git";
import type {
	FormatterInfo,
	McpResource,
	McpServerStatus,
	ProviderAuthAuthorization,
	ProviderAuthMethod,
	ProviderInfo,
	ToolInfo,
	Worktree,
} from "./opencode";
import type { VcsDiffFile, VcsInfo } from "./session";

export type OcServerOpsMessage =
	// Feature 10: Git/VCS Information
	| { type: "vcs"; data: VcsInfo; requestId?: string }
	| { type: "vcs_diff"; data: VcsDiffFile[]; requestId?: string }
	// Feature 11: File Content Read
	| {
			type: "file_content";
			data: FileContent;
			path: string;
			requestId?: string;
	  }
	// Feature 21: Binary File Content
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
	// Feature 12: File Search
	| { type: "files_found"; data: string[]; requestId?: string }
	| { type: "text_found"; data: TextSearchResult[]; requestId?: string }
	| { type: "symbols_found"; data: SymbolResult[]; requestId?: string }
	| { type: "files_and_dirs_found"; data: string[]; requestId?: string }
	// Feature 13: Session Status
	| {
			type: "session_status";
			data: Record<string, SessionStatusInfo>;
			requestId?: string;
	  }
	// Feature 14: PTY Terminal Sessions
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
	// Feature 15: MCP Server Management
	| {
			type: "mcp_status";
			data: Record<string, McpServerStatus>;
			requestId?: string;
	  }
	| {
			type: "mcp_added";
			data: Record<string, McpServerStatus>;
			requestId?: string;
	  }
	| { type: "mcp_connected"; data: boolean; name: string; requestId?: string }
	| {
			type: "mcp_disconnected";
			data: boolean;
			name: string;
			requestId?: string;
	  }
	| {
			type: "mcp_resources";
			data: Record<string, McpResource>;
			requestId?: string;
	  }
	// MCP OAuth
	| {
			type: "mcp_auth_started";
			data: { authorizationUrl: string } | null;
			name: string;
			requestId?: string;
	  }
	| {
			type: "mcp_auth_completed";
			data: boolean;
			name: string;
			requestId?: string;
	  }
	| {
			type: "mcp_auth_authenticated";
			data: Record<string, unknown> | null;
			name: string;
			requestId?: string;
	  }
	| {
			type: "mcp_auth_removed";
			data: boolean;
			name: string;
			requestId?: string;
	  }
	// Provider credentials
	| {
			type: "auth_set_result";
			data: boolean;
			providerId: string;
			requestId?: string;
	  }
	| {
			type: "auth_removed_result";
			data: boolean;
			providerId: string;
			requestId?: string;
	  }
	// Global config
	| { type: "global_config"; data: Record<string, unknown>; requestId?: string }
	// Project management
	| {
			type: "current_project";
			data: unknown | null;
			requestId?: string;
	  }
	| {
			type: "project_updated";
			data: unknown;
			requestId?: string;
	  }
	// OpenCode project operations
	| { type: "oc_git_initialized"; data: any; requestId?: string }
	| { type: "oc_paths"; data: any; requestId?: string }
	| { type: "oc_session_shell_result"; data: unknown; requestId?: string }
	// Message editing
	| {
			type: "oc_message_deleted";
			data: boolean;
			sessionId: string;
			messageId: string;
			requestId?: string;
	  }
	| {
			type: "oc_message";
			data: unknown | null;
			sessionId: string;
			messageId: string;
			requestId?: string;
	  }
	// Message part editing
	| { type: "part_deleted"; data: boolean; requestId?: string }
	| { type: "part_updated"; data: unknown; requestId?: string }
	// Workspace management (OpenCode experimental)
	| { type: "oc_workspaces"; data: unknown[]; requestId?: string }
	| { type: "oc_workspace_created"; data: unknown | null; requestId?: string }
	| { type: "oc_workspace_removed"; data: boolean; id: string; requestId?: string }
	// SDK skills
	| {
			type: "oc_sdk_skills";
			data: Array<{
				name: string;
				description: string;
				location: string;
				content: string;
			}>;
			requestId?: string;
	  }
	// OpenCode health check
	| { type: "oc_health_result"; data: { healthy: boolean; version: string } | null; requestId?: string }
	// Feature 23: Git Worktrees
	| { type: "worktrees"; data: Worktree[]; requestId?: string }
	| { type: "worktree_created"; data: Worktree; requestId?: string }
	| {
			type: "worktree_reset";
			data: boolean;
			worktreeDirectory: string;
			requestId?: string;
	  }
	| {
			type: "worktree_deleted";
			data: boolean;
			name: string;
			requestId?: string;
	  }
	// Feature 16: Full Provider Management
	| { type: "all_providers"; data: ProviderInfo; requestId?: string }
	| {
			type: "provider_auth";
			data: Record<string, ProviderAuthMethod[]>;
			requestId?: string;
	  }
	| {
			type: "provider_oauth_authorized";
			data: ProviderAuthAuthorization | null;
			providerId: string;
			requestId?: string;
	  }
	| {
			type: "provider_oauth_callback";
			data: boolean;
			providerId: string;
			requestId?: string;
	  }
	// Feature 17: Tool List
	| { type: "tool_ids"; data: string[]; requestId?: string }
	| { type: "tools"; data: ToolInfo[]; requestId?: string }
	// Feature 18: File Status (Git)
	| { type: "file_status"; data: FileStatusInfo[]; requestId?: string }
	| {
			type: "git_diff";
			data: { path?: string; diff: string; staged?: boolean };
			requestId?: string;
	  }
	// Git foundation
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
	// GitHub integration
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
	// Feature 19: Formatter Status
	| { type: "formatter_status"; data: FormatterInfo[]; requestId?: string }
	// Feature 20: Session Init
	| {
			type: "session_initialized";
			data: boolean;
			sessionId: string;
			requestId?: string;
	  }
	| { type: "instance_disposed"; data: boolean; requestId?: string }
	| {
			type: "agents_status";
			data: Record<AgentType, AgentStatusInfo>;
			requestId?: string;
	  };
