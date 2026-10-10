import type {
	CodexAppInfo,
	CodexPrompt,
	CodexRemoteSkill,
	CodexStreamMessage,
	CodexThread,
	CodexTranscriptMessage,
} from "./codex";
import type { ProjectSummary } from "./session";

export type CxServerMessage =
	// Codex (OpenAI Codex app-server)
	| {
			type: "cx_global";
			data: { method: string; params?: any };
			requestId?: string;
	  }
	| { type: "cx_error"; error: string; code?: string; handler?: string; requestId?: string }
	| { type: "cx_projects"; data: ProjectSummary[]; requestId?: string }
	| { type: "cx_warmup_started"; requestId?: string }
	| {
			type: "cx_threads";
			data: CodexThread[];
			nextCursor?: string | null;
			requestId?: string;
	  }
	| {
			type: "cx_models";
			data: any;
			nextCursor?: string | null;
			requestId?: string;
	  }
	| { type: "cx_thread"; data: CodexThread; requestId?: string }
	| { type: "cx_thread_created"; data: CodexThread; requestId?: string }
	| { type: "cx_thread_forked"; data: CodexThread; requestId?: string }
	| { type: "cx_thread_rolled_back"; data: CodexThread; requestId?: string }
	| {
			type: "cx_thread_archived";
			data: boolean;
			threadId: string;
			requestId?: string;
	  }
	| {
			type: "cx_thread_messages";
			data: CodexTranscriptMessage[];
			threadId: string;
			requestId?: string;
			hasMore?: boolean;
			nextCursor?: string;
	  }
	| { type: "cx_skills"; data: any; requestId?: string }
	| {
			type: "cx_skill";
			data: {
				name: string;
				path: string;
				scope: "Repo" | "User" | "System" | "Admin";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "cx_skill_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| { type: "cx_skill_deleted"; data: { ok: boolean }; requestId?: string }
	| { type: "cx_prompts"; data: CodexPrompt[]; requestId?: string }
	| { type: "cx_config"; data: any; requestId?: string }
	| { type: "cx_config_written"; data: any; requestId?: string }
	| {
			type: "cx_mcp_status";
			data: any;
			nextCursor?: string | null;
			requestId?: string;
	  }
	| { type: "cx_mcp_reloaded"; data: any; requestId?: string }
	| {
			type: "cx_review_started";
			data: { threadId: string; reviewThreadId: string; turnId: string };
			requestId?: string;
	  }
	| { type: "cx_account"; data: any; requestId?: string }
	| { type: "cx_login_started"; data: any; requestId?: string }
	| { type: "cx_login_canceled"; data: any; requestId?: string }
	| { type: "cx_logged_out"; data: any; requestId?: string }
	| { type: "cx_rate_limits"; data: any; requestId?: string }
	| { type: "cx_feedback_uploaded"; data: any; requestId?: string }
	| {
			type: "cx_undo_result";
			data: { ok: boolean; revertedPaths: string[]; error?: string };
			requestId?: string;
	  }
	| {
			type: "cx_modified_files";
			data: Array<{ file: string; additions: number; deletions: number }>;
			threadId: string;
			requestId?: string;
	  }
	| {
			type: "cx_agents";
			data: { exists: boolean; path: string; content: string };
			requestId?: string;
	  }
	| {
			type: "cx_agents_written";
			data: { ok: boolean; path: string };
			requestId?: string;
	  }
	// Codex new features (mid-2026 SDK update)
	| { type: "cx_steered"; data: any; requestId?: string }
	| { type: "cx_thread_renamed"; data: any; requestId?: string }
	| { type: "cx_thread_unarchived"; data: any; requestId?: string }
	| { type: "cx_thread_compacted"; data: any; requestId?: string }
	| { type: "cx_remote_skills"; data: CodexRemoteSkill[]; requestId?: string }
	| { type: "cx_remote_skill_installed"; data: any; requestId?: string }
	| { type: "cx_skill_config_written"; data: any; requestId?: string }
	| {
			type: "cx_apps";
			data: CodexAppInfo[];
			nextCursor?: string | null;
			requestId?: string;
	  }
	| {
			type: "cx_command_result";
			data: { exitCode?: number; stdout?: string; stderr?: string };
			requestId?: string;
	  }
	| { type: "cx_experimental_features_list"; data: any[]; requestId?: string }
	// Codex SDK update: new response types (#21-#25, #19)
	| { type: "cx_config_batch_written"; data: any; requestId?: string }
	| { type: "cx_config_requirements"; data: any; requestId?: string }
	| {
			type: "cx_thread_loaded_list";
			data: string[];
			nextCursor?: string | null;
			requestId?: string;
	  }
	| { type: "cx_thread_detail"; data: any; requestId?: string }
	| {
			type: "cx_mcp_oauth_login_started";
			data: { authorizationUrl: string };
			name: string;
			requestId?: string;
	  }
	| { type: "cx_apps_updated"; data: any[]; requestId?: string }
	// Codex plugin marketplace responses
	| { type: "cx_plugins"; data: any[]; requestId?: string }
	| { type: "cx_plugin_detail"; data: any; requestId?: string }
	| { type: "cx_plugin_installed"; data: { ok: boolean }; requestId?: string }
	| { type: "cx_plugin_uninstalled"; data: { ok: boolean }; requestId?: string }
	| { type: "cx_stream"; data: CodexStreamMessage; threadId: string }
	// Codex workspace / changeset revert
	| { type: "cx_changes_reverted"; data: { ok: boolean; error?: string; filesReverted?: string[] }; requestId?: string }
	| {
			type: "cx_turn_diff";
			data: { diff: string; files: string[]; turnId?: string; error?: string };
			requestId?: string;
	  }
	// Codex fuzzy file search
	| {
			type: "cx_fuzzy_search_results";
			data: { sessionId: string; results: Array<{ path: string; name: string; score: number }>; completed?: boolean };
			requestId?: string;
	  }
	| { type: "cx_fuzzy_search_ended"; data: { ok: boolean }; requestId?: string }
	// Codex filesystem watch responses
	| { type: "cx_fs_watched"; data: { subscriptionId: string; ok: boolean; error?: string }; requestId?: string }
	| { type: "cx_fs_unwatched"; data: { ok: boolean; error?: string }; requestId?: string };
