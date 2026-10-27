import type { FileAttachment, PermissionResponse, PermissionRuleset } from "./common";

export type OcClientMessage =
	| {
			type: "list_sessions";
			projectPath?: string;
			roots?: boolean;
			start?: number;
			cursor?: number;
			before?: string;
			search?: string;
			limit?: number;
			archived?: boolean;
	  }
	| { type: "list_providers" }
	| { type: "get_config"; projectPath?: string }
	| { type: "set_config"; config: Record<string, any>; projectPath?: string }
	| { type: "set_model"; model: string; projectPath?: string }
	| {
			type: "create_session";
			projectPath?: string;
			title?: string;
			permission?: PermissionRuleset;
			workspaceID?: string;
	  }
	| { type: "get_session"; sessionId: string; projectPath?: string }
	| {
			type: "get_session_messages";
			sessionId: string;
			projectPath?: string;
			limit?: number;
			before?: string;
	  }
	| {
			type: "chat";
			sessionId: string;
			content: string;
			projectPath?: string;
			messageId?: string;
			model?: { providerID: string; modelID: string };
			agent?: string;
			fileAttachments?: FileAttachment[];
			variant?: string;
			noReply?: boolean;
			system?: string;
			format?: { type: "text" } | { type: "json_schema"; json_schema: Record<string, unknown> };
	  }
	| { type: "abort"; sessionId: string; projectPath?: string }
	| {
			type: "diff";
			sessionId: string;
			projectPath?: string;
			messageId?: string;
	  }
	| { type: "browse"; path: string; projectPath?: string }
	| {
			type: "permission_response";
			sessionId: string;
			permissionId: string;
			response: PermissionResponse;
			message?: string;
			projectPath?: string;
	  }
	| { type: "list_pending_permissions"; projectPath?: string }
	| { type: "list_pending_questions"; projectPath?: string }
	| { type: "get_lsp_status"; projectPath?: string }
	| { type: "get_session_context"; sessionId: string; projectPath?: string }
	// Feature 1: Todo/Plan Management
	| { type: "get_todos"; sessionId: string; projectPath?: string }
	// Feature 2: Slash Commands
	| { type: "list_commands"; projectPath?: string }
	| {
			type: "execute_command";
			sessionId: string;
			command: string;
			arguments: string;
			projectPath?: string;
			agent?: string;
			model?: string;
			variant?: string;
			parts?: Array<{
				id?: string;
				type: "file";
				mime: string;
				filename?: string;
				url: string;
				source?: Record<string, unknown>;
			}>;
	  }
	// Feature 3: Agent Switching
	| { type: "list_agents"; projectPath?: string }
	// Feature 4: Session Delete
	| { type: "delete_session"; sessionId: string; projectPath?: string }
	// Feature 5: Session Update (Rename)
	| {
			type: "update_session";
			sessionId: string;
			title?: string;
			archived?: boolean;
			projectPath?: string;
	  }
	// Feature 6: Session Fork
	| {
			type: "fork_session";
			sessionId: string;
			messageId?: string;
			projectPath?: string;
	  }
	| { type: "session_children"; sessionId: string; projectPath?: string }
	// Feature 7: Message Revert (Undo)
	| {
			type: "revert_message";
			sessionId: string;
			messageId: string;
			partId?: string;
			projectPath?: string;
	  }
	| { type: "unrevert_session"; sessionId: string; projectPath?: string }
	// Feature 8: Session Share
	| { type: "share_session"; sessionId: string; projectPath?: string }
	| { type: "unshare_session"; sessionId: string; projectPath?: string }
	// Feature 9: Session Summarize (Compact)
	| {
			type: "summarize_session";
			sessionId: string;
			providerID: string;
			modelID: string;
			projectPath?: string;
			auto?: boolean;
	  }
	// Feature 10: Git/VCS Information
	| { type: "get_vcs"; projectPath?: string }
	| { type: "get_vcs_diff"; projectPath?: string; mode: "git" | "branch" }
	| { type: "git_review_diff"; projectPath?: string; mode: "git" | "branch" }
	// Feature 11: File Content Read
	| { type: "read_file"; path: string; projectPath?: string }
	// Feature 21: Binary File Content Read (images, PDFs, etc.)
	| { type: "read_file_binary"; path: string; maxSizeMb?: number }
	// Feature 12: File Search
	| { type: "find_files"; query: string; projectPath?: string }
	| {
			type: "find_text";
			pattern: string;
			include?: string;
			projectPath?: string;
	  }
	| { type: "find_symbols"; query: string; projectPath?: string }
	| { type: "search_files_and_dirs"; query: string; projectPath?: string }
	// Feature 13: Session Status
	| { type: "get_session_status"; projectPath?: string }
	// Feature 14: PTY Terminal Sessions
	| { type: "list_pty"; projectPath?: string }
	| {
			type: "create_pty";
			command?: string;
			args?: string[];
			cwd?: string;
			title?: string;
			env?: Record<string, string>;
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
	// Feature 14b: PTY Interactive Terminal I/O
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
	// Feature 15: MCP Server Management
	| { type: "get_mcp_status"; projectPath?: string }
	| {
			type: "add_mcp";
			name: string;
			config: Record<string, unknown>;
			projectPath?: string;
	  }
	| { type: "connect_mcp"; name: string; projectPath?: string }
	| { type: "disconnect_mcp"; name: string; projectPath?: string }
	| { type: "get_mcp_resources"; projectPath?: string }
	// MCP OAuth Authentication
	| { type: "mcp_auth_start"; name: string; projectPath?: string }
	| {
			type: "mcp_auth_callback";
			name: string;
			code: string;
			projectPath?: string;
	  }
	| { type: "mcp_auth_authenticate"; name: string; projectPath?: string }
	| { type: "mcp_auth_remove"; name: string; projectPath?: string }
	// Provider credential management
	| {
			type: "auth_set";
			providerId: string;
			auth: Record<string, unknown>;
			projectPath?: string;
	  }
	| { type: "auth_remove"; providerId: string; projectPath?: string }
	// Global config
	| { type: "get_global_config" }
	| { type: "set_global_config"; config: Record<string, unknown> }
	// Project management
	| { type: "get_current_project"; projectPath?: string }
	| {
			type: "update_project";
			projectId: string;
			name?: string;
			icon?: Record<string, unknown>;
			projectPath?: string;
	  }
	// Message editing
	| {
			type: "oc_delete_message";
			sessionId: string;
			messageId: string;
			projectPath?: string;
	  }
	| {
			type: "oc_get_message";
			sessionId: string;
			messageId: string;
			projectPath?: string;
	  }
	// Message part editing
	| {
			type: "delete_part";
			sessionId: string;
			messageId: string;
			partId: string;
			projectPath?: string;
	  }
	| {
			type: "update_part";
			sessionId: string;
			messageId: string;
			partId: string;
			part: Record<string, unknown>;
			projectPath?: string;
	  };
