import type { FileAttachment, PermissionResponse } from "./common";

export type CxClientMessage =
	// Codex (OpenAI Codex app-server) messages
	| { type: "cx_list_projects"; refresh?: boolean }
	| {
			type: "cx_list_threads";
			cwd?: string;
			cursor?: string | null;
			before?: string;
			limit?: number | null;
			refresh?: boolean;
			sourceKinds?: string[];
			sortKey?: string;
			modelProviders?: string[];
			archived?: boolean;
			searchTerm?: string;
	  }
	| { type: "cx_warmup"; limit?: number }
	| {
			type: "cx_start_thread";
			cwd?: string;
			model?: string;
			approvalPolicy?: string;
			sandbox?: string;
			personality?: "none" | "friendly" | "pragmatic";
	  }
	| {
			type: "cx_resume_thread";
			threadId: string;
			personality?: "none" | "friendly" | "pragmatic";
	  }
	| { type: "cx_archive_thread"; threadId: string }
	| { type: "cx_get_thread_messages"; threadId: string; limit?: number; before?: string }
	| {
			type: "cx_chat";
			threadId?: string;
			prompt: string;
			cwd?: string;
			model?: string;
			effort?: string;
			summary?: string;
			approvalPolicy?: string;
			sandbox?: string;
			sandboxPolicy?: any;
			config?: Record<string, any>;
			baseInstructions?: string;
			developerInstructions?: string;
			fileAttachments?: FileAttachment[];
			skillMentions?: Array<{ name?: string; path?: string }>;
			fileMentions?: Array<{ name?: string; path?: string }>;
			serviceTier?: string | null;
			outputSchema?: Record<string, unknown>;
			// SDK ModeKind: "plan" | "default". Legacy values accepted for backward compat and mapped to "default".
			collaborationMode?:
				| "plan"
				| "default"
				| "code"
				| "pair_programming"
				| "pairprogramming"
				| "pairProgramming"
				| "execute"
				| "custom";
			// SDK Personality: "none" | "friendly" | "pragmatic" (default: pragmatic)
			personality?: "none" | "friendly" | "pragmatic";
	  }
	| { type: "cx_abort"; threadId: string; turnId?: string }
	| {
			type: "cx_permission_response";
			requestId: string;
			threadId?: string;
			response: PermissionResponse;
			execpolicyAmendment?: any;
			networkPolicyAmendment?: { host: string; action: "allow" | "deny" };
	  }
	// Codex request_user_input response (SDK v0.87.0+)
	| {
			type: "cx_user_input_response";
			requestId: string;
			answers: Record<string, { answers: string[] }>;
	  }
	| { type: "cx_thread_fork"; threadId: string }
	| { type: "cx_thread_rollback"; threadId: string; numTurns: number }
	| { type: "cx_model_list" }
	| { type: "cx_skills_list"; cwd?: string; forceReload?: boolean }
	| {
			type: "cx_get_skill";
			name: string;
			scope: "Repo" | "User" | "System" | "Admin";
			cwd?: string;
	  }
	| {
			type: "cx_save_skill";
			name: string;
			scope: "Repo" | "User";
			content: string;
			cwd?: string;
	  }
	| {
			type: "cx_delete_skill";
			name: string;
			scope: "Repo" | "User";
			cwd?: string;
	  }
	| { type: "cx_list_prompts"; cwd?: string }
	| { type: "cx_config_read" }
	| {
			type: "cx_config_value_write";
			keyPath: string;
			value: any;
			mergeStrategy?: string;
	  }
	| {
			type: "cx_mcp_status_list";
			cursor?: string | null;
			limit?: number | null;
			detail?: "full" | "toolsAndAuthOnly" | null;
	  }
	| { type: "cx_mcp_reload" }
	| {
			type: "cx_review_start";
			threadId?: string;
			cwd?: string;
			delivery?: "inline" | "detached";
			personality?: "none" | "friendly" | "pragmatic";
			target?: any;
			model?: string;
			approvalPolicy?: string;
			sandbox?: string;
			sandboxPolicy?: any;
			config?: Record<string, any>;
	  }
	| { type: "cx_account_read"; refreshToken?: boolean }
	| { type: "cx_login_start"; loginType: "chatgpt" | "chatgptDeviceCode" | "apiKey"; apiKey?: string }
	| { type: "cx_login_cancel"; loginId: string }
	| { type: "cx_logout" }
	| { type: "cx_rate_limits_read" }
	| {
			type: "cx_feedback_upload";
			classification: string;
			reason?: string | null;
			threadId?: string | null;
			includeLogs?: boolean;
			extraLogFiles?: string[] | null;
	  }
	| { type: "cx_undo_files"; threadId: string; count?: number }
	| { type: "cx_get_modified_files"; threadId: string }
	| { type: "cx_agents_read"; cwd: string }
	| { type: "cx_agents_write"; cwd: string; content: string }
	// Codex new features (mid-2026 SDK update)
	| { type: "cx_steer"; threadId: string; prompt: string; turnId?: string }
	| { type: "cx_thread_rename"; threadId: string; name: string }
	| { type: "cx_thread_unarchive"; threadId: string }
	| { type: "cx_thread_compact"; threadId: string }
	| {
			type: "cx_remote_skills_list";
			hazelnutScope?: "example" | "workspace-shared" | "all-shared" | "personal";
			productSurface?: "chatgpt" | "codex" | "api" | "atlas";
			enabled?: boolean;
	  }
	| { type: "cx_remote_skill_install"; hazelnutId: string; isPreload?: boolean }
	| { type: "cx_skill_config_write"; path: string; enabled: boolean }
	| {
			type: "cx_apps_list";
			cursor?: string | null;
			limit?: number | null;
			threadId?: string;
			forceRefetch?: boolean;
	  }
	| {
			type: "cx_command_exec";
			command: string[];
			timeoutMs?: number;
			cwd?: string;
			sandboxPolicy?: any;
	  }
	| {
			type: "cx_experimental_features";
			cursor?: string | null;
			limit?: number | null;
	  }
	// Codex SDK update: new methods (#21-#25, #27)
	| {
			type: "cx_config_batch_write";
			edits: Array<{ keyPath: string; value: any; mergeStrategy?: string }>;
			filePath?: string;
			expectedVersion?: string;
	  }
	| { type: "cx_config_requirements_read" }
	| {
			type: "cx_thread_loaded_list";
			cursor?: string | null;
			limit?: number | null;
	  }
	| { type: "cx_thread_read"; threadId: string; includeTurns?: boolean }
	| {
			type: "cx_mcp_oauth_login";
			name: string;
			scopes?: string[];
			timeoutSecs?: number;
	  }
	// Codex external config detection/import
	| { type: "cx_external_config_detect"; cwds?: string[]; includeHome?: boolean }
	| { type: "cx_external_config_import"; source: string; configPath?: string; importOptions?: Record<string, unknown> }
	// Codex plugin marketplace
	| { type: "cx_plugin_list"; cwd?: string }
	| { type: "cx_plugin_install"; marketplacePath: string; pluginName: string }
	| { type: "cx_plugin_uninstall"; pluginId: string }
	| { type: "cx_plugin_read"; marketplacePath: string; pluginName: string; requestId?: string }
	// Codex thread lifecycle
	| { type: "cx_thread_unsubscribe"; threadId: string }
	| { type: "cx_collaboration_modes"; threadId?: string }
	| { type: "cx_background_terminals_clean"; threadId?: string }
	| { type: "cx_shell_command"; threadId: string; command: string; requestId?: string }
	// Codex workspace / changeset revert
	| { type: "cx_revert_changes"; threadId: string; diff: string; cwd?: string; requestId?: string }
	| { type: "cx_get_turn_diff"; threadId: string; turnId?: string; cwd?: string; requestId?: string }
	// Codex fuzzy file search
	| {
			type: "cx_fuzzy_search_start";
			threadId?: string;
			query: string;
			cwd?: string;
			maxResults?: number;
			requestId?: string;
	  }
	| { type: "cx_fuzzy_search_update"; sessionId: string; query: string; requestId?: string }
	| { type: "cx_fuzzy_search_end"; sessionId: string; requestId?: string }
	// Codex filesystem watch
	| { type: "cx_fs_watch"; paths: string[]; threadId?: string; requestId?: string }
	| { type: "cx_fs_unwatch"; subscriptionId: string; requestId?: string }
	// Codex command PTY
	| { type: "cx_command_write"; processId: string; deltaBase64?: string; closeStdin?: boolean }
	| { type: "cx_command_resize"; processId: string; rows?: number; cols?: number }
	| { type: "cx_command_terminate"; processId: string }
	// Codex thread metadata update
	| { type: "cx_thread_metadata_update"; threadId: string; gitInfo?: Record<string, unknown> };
