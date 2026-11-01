export type WorkspaceClientMessage =
	| { type: "git_review_diff"; projectPath?: string; mode: "git" | "branch" }
	| { type: "read_file"; path: string; projectPath?: string }
	| { type: "read_file_binary"; path: string; maxSizeMb?: number }
	| { type: "browse"; path: string; projectPath?: string }
	| { type: "search_files_and_dirs"; query: string; projectPath?: string }
	| { type: "list_pty"; projectPath?: string }
	| {
			type: "create_pty";
			command?: string;
			args?: string[];
			cwd?: string;
			title?: string;
			projectPath?: string;
	  }
	| { type: "get_pty"; ptyId: string; projectPath?: string }
	| {
			type: "update_pty";
			ptyId: string;
			title?: string;
			rows?: number;
			cols?: number;
			projectPath?: string;
	  }
	| { type: "delete_pty"; ptyId: string; projectPath?: string }
	| { type: "pty_connect"; ptyId: string; projectPath?: string }
	| { type: "pty_disconnect"; ptyId: string }
	| { type: "pty_input"; ptyId: string; data: string }
	| {
			type: "pty_resize";
			ptyId: string;
			rows: number;
			cols: number;
			projectPath?: string;
	  }
	| { type: "git_diff"; projectPath: string; path?: string; staged?: boolean }
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
	| { type: "get_agents_status" };
