import type {
	ClaudeCodeCommand,
	ClaudeCodeConfig,
	ClaudeCodeCustomTool,
	ClaudeCodeFilesystemAgent,
	ClaudeCodeHook,
	ClaudeCodeMemoryEntry,
	ClaudeCodePermissionMode,
	ClaudeCodePlugin,
	ClaudeCodePluginConfig,
	ClaudeCodeSession,
	ClaudeCodeSkill,
} from "./claude-code";
import type {
	ClaudeCodeAccountInfo,
	ClaudeCodeMcpServerStatus,
	ClaudeCodeSupportedModel,
	ClaudeCodeTranscriptMessage,
} from "./claude-code-stream";
import type { ClaudeCodeStreamMessage } from "./claude-code-stream-message";
import type { ProjectSummary } from "./session";

export type CcServerMessage =
	| { type: "cc_projects"; data: ProjectSummary[]; requestId?: string }
	| {
			type: "cc_sessions";
			data: ClaudeCodeSession[];
			hasMore?: boolean;
			nextCursor?: string;
			requestId?: string;
	  }
	| { type: "cc_session"; data: ClaudeCodeSession; requestId?: string }
	| {
			type: "cc_session_deleted";
			data: boolean;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "cc_modified_files";
			data: Array<{ file: string; additions: number; deletions: number }>;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "cc_session_forked";
			data: ClaudeCodeSession | null;
			requestId?: string;
	  }
	| {
			type: "cc_session_renamed";
			data: ClaudeCodeSession | null;
			requestId?: string;
	  }
	| {
			type: "cc_session_backgrounded";
			data: boolean;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "cc_session_messages";
			data: ClaudeCodeTranscriptMessage[];
			sessionId: string;
			requestId?: string;
			hasMore?: boolean;
			nextCursor?: string;
	  }
	| { type: "cc_skills"; data: ClaudeCodeSkill[]; requestId?: string }
	| {
			type: "cc_skill";
			data: {
				name: string;
				path: string;
				source: "project" | "user" | "plugin";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "cc_skill_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| { type: "cc_skill_deleted"; data: { ok: boolean }; requestId?: string }
	| { type: "cc_hooks"; data: ClaudeCodeHook[]; requestId?: string }
	| {
			type: "cc_hooks_file";
			data: {
				ok: boolean;
				source: "project" | "user";
				path: string;
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "cc_hooks_file_written";
			data: { ok: boolean; source: "project" | "user"; path: string };
			requestId?: string;
	  }
	| {
			type: "cc_mcp_file";
			data: { ok: boolean; path: string; content: string };
			requestId?: string;
	  }
	| {
			type: "cc_mcp_file_written";
			data: { ok: boolean; path: string };
			requestId?: string;
	  }
	| { type: "cc_commands"; data: ClaudeCodeCommand[]; requestId?: string }
	| { type: "cc_agents"; data: ClaudeCodeFilesystemAgent[]; requestId?: string }
	| { type: "cc_memories"; data: ClaudeCodeMemoryEntry[]; requestId?: string }
	| {
			type: "cc_memory_deleted";
			data: { ok: boolean; filename: string; scope: string };
			requestId?: string;
	  }
	| {
			type: "cc_active_sessions";
			data: Array<{ id: string; cwd: string; startedAt?: number }>;
			requestId?: string;
	  }
	| {
			type: "cc_command_file";
			data: {
				ok: boolean;
				name: string;
				source: "project" | "user" | "plugin";
				path: string;
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "cc_command_saved";
			data: {
				ok: boolean;
				name: string;
				source: "project" | "user";
				path?: string;
			};
			requestId?: string;
	  }
	| {
			type: "cc_command_deleted";
			data: { ok: boolean; name: string; source: "project" | "user" };
			requestId?: string;
	  }
	| { type: "cc_config"; data: ClaudeCodeConfig; requestId?: string }
	| { type: "cc_config_updated"; data: ClaudeCodeConfig; requestId?: string }
	| {
			type: "cc_supported_models";
			data: ClaudeCodeSupportedModel[];
			requestId?: string;
	  }
	| { type: "cc_account_info"; data: ClaudeCodeAccountInfo; requestId?: string }
	| {
			type: "cc_mcp_server_status";
			data: ClaudeCodeMcpServerStatus[];
			requestId?: string;
	  }
	| {
			type: "cc_checkpoint_rewound";
			data: {
				success: boolean;
				sessionId: string;
				checkpointUuid: string;
				filesChanged?: string[];
				insertions?: number;
				deletions?: number;
			};
			requestId?: string;
	  }
	| {
			type: "cc_task_stopped";
			data: { ok: boolean; taskId: string };
			requestId?: string;
	  }
	| {
			type: "cc_mcp_server_reconnected";
			data: { ok: boolean; serverName: string };
			requestId?: string;
	  }
	| {
			type: "cc_mcp_server_toggled";
			data: { ok: boolean; serverName: string; enabled: boolean };
			requestId?: string;
	  }
	| {
			type: "cc_permission_mode_set";
			data: { ok: boolean; mode: ClaudeCodePermissionMode };
			requestId?: string;
	  }
	| {
			type: "cc_model_set";
			data: { ok: boolean; model?: string };
			requestId?: string;
	  }
	| {
			type: "cc_mcp_servers_set";
			data: {
				added: string[];
				removed: string[];
				errors: Record<string, string>;
			} | null;
			requestId?: string;
	  }
	| {
			type: "cc_initialization_result";
			data: Record<string, unknown> | null;
			requestId?: string;
	  }
	| {
			type: "cc_fs_changed";
			data: {
				kind: "skills" | "plugins" | "hooks" | "commands" | "mcp";
				dir: string;
				cwd?: string;
				file?: string;
			};
			requestId?: string;
	  }
	// SDK 0.2.87: Context usage breakdown
	| {
			type: "cc_context_usage";
			data: Record<string, unknown> | null;
			error?: string;
			requestId?: string;
	  }
	// SDK 0.2.87: Apply settings response
	| {
			type: "cc_settings_applied";
			data: { ok: boolean };
			error?: string;
			requestId?: string;
	  }
	// SDK 0.2.87: Tag session response
	| {
			type: "cc_session_tagged";
			data: { ok: boolean };
			error?: string;
			requestId?: string;
	  }
	// SDK 0.2.87: Live plugin reload response (Query method)
	| {
			type: "cc_plugins_reloaded_live";
			data: {
				commands: unknown[];
				agents: unknown[];
				plugins: unknown[];
				mcpServers: unknown[];
				errorCount: number;
			} | null;
			error?: string;
			requestId?: string;
	  }
	| { type: "cc_stream"; data: ClaudeCodeStreamMessage; sessionId: string }
	// SDK 0.2.92: Subagent inspection responses
	| { type: "cc_subagents"; data: string[]; requestId?: string }
	| { type: "cc_subagent_messages"; data: Array<{ role: string; content: unknown; uuid?: string }>; requestId?: string }
	// Claude Code Custom Tools
	| {
			type: "cc_custom_tools";
			data: ClaudeCodeCustomTool[];
			requestId?: string;
	  }
	| {
			type: "cc_custom_tool";
			data: ClaudeCodeCustomTool | null;
			requestId?: string;
	  }
	| {
			type: "cc_custom_tool_saved";
			data: ClaudeCodeCustomTool;
			requestId?: string;
	  }
	| {
			type: "cc_custom_tool_deleted";
			data: boolean;
			id: string;
			requestId?: string;
	  }
	| {
			type: "cc_custom_tool_test_result";
			data: { success: boolean; result?: string; error?: string };
			requestId?: string;
	  }
	// Claude Code Plugins
	| { type: "cc_plugins"; data: ClaudeCodePlugin[]; requestId?: string }
	| { type: "cc_plugin"; data: ClaudeCodePlugin | null; requestId?: string }
	| {
			type: "cc_plugin_toggled";
			data: boolean;
			name: string;
			enabled: boolean;
			requestId?: string;
	  }
	| {
			type: "cc_plugin_path_added";
			data: boolean;
			path: string;
			requestId?: string;
	  }
	| {
			type: "cc_plugin_path_removed";
			data: boolean;
			path: string;
			requestId?: string;
	  }
	| {
			type: "cc_plugin_config";
			data: ClaudeCodePluginConfig;
			requestId?: string;
	  }
	| {
			type: "cc_plugins_reloaded";
			data: ClaudeCodePlugin[];
			requestId?: string;
	  };
