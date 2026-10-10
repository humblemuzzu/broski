import type {
	ClaudeCodeBeta,
	ClaudeCodeConfig,
	ClaudeCodeCustomTool,
	ClaudeCodeEffort,
	ClaudeCodeOutputFormat,
	ClaudeCodePermissionMode,
	ClaudeCodeSandboxSettings,
	ClaudeCodeSystemPrompt,
	ClaudeCodeThinkingOption,
} from "./claude-code";
import type { FileAttachment, PermissionResponse } from "./common";

export type CcClientMessage =
	// Claude Code-specific messages
	| { type: "cc_list_projects" }
	| { type: "cc_list_sessions"; cwd?: string }
	| { type: "cc_get_session"; sessionId: string; cwd?: string }
	| {
			type: "cc_get_session_messages";
			sessionId: string;
			cwd?: string;
			limit?: number;
			before?: string;
	  }
	| { type: "cc_delete_session"; sessionId: string; cwd?: string }
	| { type: "cc_get_modified_files"; sessionId: string; cwd?: string }
	| {
			type: "cc_fork_session";
			sessionId: string;
			messageId?: string;
			cwd?: string;
	  }
	| {
			type: "cc_chat";
			sessionId?: string;
			prompt: string;
			cwd?: string;
			model?: string;
			permissionMode?: ClaudeCodePermissionMode;
			allowedTools?: string[];
			disallowedTools?: string[];
			maxThinkingTokens?: number | null;
			maxTurns?: number;
			maxBudgetUsd?: number;
			betas?: ClaudeCodeBeta[];
			variant?: string;
			thinking?: ClaudeCodeThinkingOption;
			effort?: ClaudeCodeEffort;
			agent?: string;
			systemPrompt?: ClaudeCodeSystemPrompt;
			activeSubagent?: string;
			fileAttachments?: FileAttachment[];
			resumeSessionAt?: string;
			outputFormat?: ClaudeCodeOutputFormat;
			sandbox?: ClaudeCodeSandboxSettings;
			enableAgentTeams?: boolean;
			persistSession?: boolean;
			promptSuggestions?: boolean;
			enableClaudeAiMcpServers?: boolean;
			// B5: fallback model for auto-retry on primary model failure
			fallbackModel?: string;
			// B6: additional directories agent can access beyond cwd
			additionalDirectories?: string[];
			// SDK 0.2.74: enable AI-generated progress summaries for subagents
			agentProgressSummaries?: boolean;
			continueSession?: boolean;
			forkOnResume?: boolean;
	  }
	| { type: "cc_abort"; sessionId: string }
	| { type: "cc_stop_task"; sessionId: string; taskId: string }
	| { type: "cc_reconnect_mcp_server"; sessionId: string; serverName: string }
	| {
			type: "cc_toggle_mcp_server";
			sessionId: string;
			serverName: string;
			enabled: boolean;
	  }
	// B1: change permission mode mid-session
	| {
			type: "cc_set_permission_mode";
			sessionId: string;
			mode: ClaudeCodePermissionMode;
	  }
	// B2: change model mid-session
	| { type: "cc_set_model"; sessionId: string; model?: string }
	// B7: dynamically set MCP servers mid-session
	| {
			type: "cc_set_mcp_servers";
			sessionId: string;
			servers: Record<string, unknown>;
	  }
	// B3: get full initialization result (richer than session-init)
	| { type: "cc_initialization_result"; sessionId: string }
	| {
			type: "cc_permission_response";
			sessionId: string;
			toolUseId: string;
			response: PermissionResponse;
			// For AskUserQuestion: pass user-selected answers back to SDK via updatedInput
			updatedInput?: Record<string, unknown>;
			updatedPermissions?: unknown[];
			decisionClassification?: string;
			reason?: string;
	  }
	| {
			type: "cc_elicitation_response";
			sessionId: string;
			requestId: string;
			action: "accept" | "decline" | "cancel";
			content?: Record<string, unknown>;
	  }
	| { type: "cc_list_skills"; cwd?: string }
	| {
			type: "cc_get_skill";
			name: string;
			source: "project" | "user" | "plugin";
			cwd?: string;
			path?: string;
	  }
	| {
			type: "cc_save_skill";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "cc_delete_skill";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| { type: "cc_list_hooks"; cwd?: string }
	| { type: "cc_hooks_file_read"; source: "project" | "user"; cwd?: string }
	| {
			type: "cc_hooks_file_write";
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| { type: "cc_mcp_file_read"; cwd: string }
	| { type: "cc_mcp_file_write"; cwd: string; content: string }
	| { type: "cc_list_commands"; cwd?: string }
	| {
			type: "cc_get_command";
			name: string;
			source: "project" | "user" | "plugin";
			cwd?: string;
			path?: string;
	  }
	| {
			type: "cc_save_command";
			name: string;
			source: "project" | "user";
			content: string;
			cwd?: string;
	  }
	| {
			type: "cc_delete_command";
			name: string;
			source: "project" | "user";
			cwd?: string;
	  }
	| { type: "cc_get_config"; cwd?: string }
	| { type: "cc_set_config"; config: Partial<ClaudeCodeConfig>; cwd?: string }
	| { type: "cc_get_supported_models"; cwd?: string }
	| { type: "cc_get_account_info"; cwd?: string }
	| { type: "cc_get_mcp_server_status"; cwd?: string }
	| { type: "cc_list_agents"; cwd?: string; projectPath?: string }
	| {
			type: "cc_list_memories";
			scope?: "user" | "project" | "local";
			cwd?: string;
	  }
	| {
			type: "cc_delete_memory";
			scope: "user" | "project" | "local";
			filename: string;
			cwd?: string;
	  }
	| { type: "cc_get_active_sessions" }
	| { type: "cc_rename_session"; sessionId: string; name: string; cwd?: string }
	| { type: "cc_background_session"; sessionId: string; cwd?: string }
	| { type: "cc_get_context_usage"; sessionId: string; requestId?: string }
	| { type: "cc_apply_settings"; sessionId: string; settings: Record<string, unknown>; requestId?: string }
	| { type: "cc_tag_session"; sessionId: string; tag?: string | null; cwd?: string; requestId?: string }
	// SDK 0.2.92: Subagent inspection
	| { type: "cc_list_subagents"; sessionId: string; cwd?: string; requestId?: string }
	| {
			type: "cc_get_subagent_messages";
			sessionId: string;
			agentId: string;
			cwd?: string;
			limit?: number;
			offset?: number;
			requestId?: string;
	  }
	// Claude Code File Checkpointing (Undo/Revert)
	| {
			type: "cc_rewind_checkpoint";
			sessionId: string;
			checkpointUuid: string;
			cwd: string;
	  }
	// Claude Code Custom Tools
	| { type: "cc_list_custom_tools" }
	| { type: "cc_get_custom_tool"; id: string }
	| { type: "cc_save_custom_tool"; tool: ClaudeCodeCustomTool }
	| { type: "cc_delete_custom_tool"; id: string }
	| {
			type: "cc_test_custom_tool";
			tool: ClaudeCodeCustomTool;
			testArgs: Record<string, unknown>;
	  }
	// Claude Code Plugins
	| { type: "cc_list_plugins"; cwd?: string }
	| { type: "cc_get_plugin"; name: string }
	| { type: "cc_toggle_plugin"; name: string; enabled: boolean }
	| { type: "cc_add_plugin_path"; path: string }
	| { type: "cc_remove_plugin_path"; path: string }
	| { type: "cc_get_plugin_config" }
	| { type: "cc_reload_plugins"; cwd?: string };
