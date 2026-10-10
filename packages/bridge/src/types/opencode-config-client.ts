export type OcConfigClientMessage =
	// Workspace management (OpenCode experimental)
	| { type: "oc_list_workspaces"; projectPath?: string }
	| {
			type: "oc_create_workspace";
			id: string;
			branch?: string | null;
			configDirectory?: string;
			projectPath?: string;
	  }
	| { type: "oc_remove_workspace"; id: string; projectPath?: string }
	// SDK skills endpoint
	| { type: "oc_list_sdk_skills"; projectPath?: string }
	// OpenCode health check
	| { type: "oc_health"; requestId?: string }
	// Feature 23: Git Worktrees (SDK v1.1.1+ experimental)
	| { type: "list_worktrees"; projectPath?: string }
	| {
			type: "create_worktree";
			name?: string;
			startCommand?: string;
			projectPath?: string;
	  }
	| { type: "reset_worktree"; worktreeDirectory: string; projectPath?: string }
	| { type: "delete_worktree"; name: string; projectPath?: string }
	// Feature 16: Full Provider Management
	| { type: "list_all_providers"; projectPath?: string }
	| { type: "get_provider_auth"; projectPath?: string }
	| {
			type: "provider_oauth_authorize";
			providerId: string;
			method: number;
			projectPath?: string;
			inputs?: Record<string, string>;
	  }
	| {
			type: "provider_oauth_callback";
			providerId: string;
			method: number;
			code?: string;
			projectPath?: string;
	  }
	// Feature 17: Tool List
	| { type: "list_tool_ids"; projectPath?: string }
	| {
			type: "list_tools";
			provider: string;
			model: string;
			projectPath?: string;
	  }
	// Feature 18: File Status (Git)
	| { type: "get_file_status"; projectPath?: string }
	// Feature 18b: Git diff (working tree / staged)
	| { type: "git_diff"; projectPath: string; path?: string; staged?: boolean }
	// Git foundation
	| { type: "git_status"; projectPath: string }
	| { type: "git_log"; projectPath: string; limit?: number }
	| { type: "git_branches"; projectPath: string }
	| { type: "git_stage"; projectPath: string; path?: string }
	| { type: "git_unstage"; projectPath: string; path?: string }
	| { type: "git_revert_file"; projectPath: string; path: string }
	| { type: "git_commit"; projectPath: string; message: string }
	| { type: "git_push"; projectPath: string; force?: boolean }
	| { type: "git_pull"; projectPath: string; rebase?: boolean }
	| { type: "git_fetch"; projectPath: string }
	| { type: "git_checkout"; projectPath: string; branch: string }
	| {
			type: "git_create_branch";
			projectPath: string;
			name: string;
			startPoint?: string;
	  }
	| { type: "git_stash"; projectPath: string }
	| { type: "git_stash_pop"; projectPath: string }
	| { type: "git_commit_diff"; projectPath: string; hash: string }
	// GitHub integration
	| { type: "github_remote"; projectPath: string }
	| {
			type: "github_issues";
			projectPath: string;
			state?: "open" | "closed" | "all";
	  }
	| {
			type: "github_prs";
			projectPath: string;
			state?: "open" | "closed" | "all";
	  }
	| { type: "github_pr_diff"; projectPath: string; prNumber: number }
	| { type: "github_pr_comments"; projectPath: string; prNumber: number }
	// Feature 19: Formatter Status
	| { type: "get_formatter_status"; projectPath?: string }
	// Feature 20: Session Init
	| {
			type: "init_session";
			sessionId: string;
			providerID: string;
			modelID: string;
			messageID: string;
			projectPath?: string;
	  }
	// Feature 22: Instance Disposal (Clear project context)
	| { type: "dispose_instance"; projectPath?: string }
	| { type: "get_agents_status" }
	// Skills (filesystem-backed)
	| { type: "oc_list_skills"; cwd?: string }
	| {
			type: "oc_get_skill";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| {
			type: "oc_save_skill";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "oc_delete_skill";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| { type: "oc_list_plugin_files"; cwd?: string }
	| {
			type: "oc_get_plugin_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| {
			type: "oc_save_plugin_file";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "oc_delete_plugin_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	// OpenCode custom markdown files (filesystem-backed)
	| { type: "oc_list_command_files"; cwd?: string }
	| {
			type: "oc_get_command_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| {
			type: "oc_save_command_file";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "oc_delete_command_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| { type: "oc_list_agent_files"; cwd?: string }
	| {
			type: "oc_get_agent_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| {
			type: "oc_save_agent_file";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "oc_delete_agent_file";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	// OpenCode Question Tool
	| {
			type: "oc_question_reply";
			questionId: string;
			answers: string[][];
			projectPath?: string;
	  }
	| { type: "oc_question_reject"; questionId: string; projectPath?: string }
	// OpenCode project operations
	| { type: "oc_init_git"; projectPath?: string }
	| { type: "oc_get_paths"; projectPath?: string }
	// OpenCode shell command
	| {
			type: "oc_session_shell";
			sessionId: string;
			command: string;
			projectPath?: string;
			agent?: string;
			model?: string | { providerID: string; modelID: string };
			messageId?: string;
	  };
