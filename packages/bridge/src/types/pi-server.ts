import type {
	PiCommandPayload,
	PiDefaultModelPayload,
	PiForkMessagePayload,
	PiModelPayload,
	PiQueueState,
	PiSelectedModelPayload,
	PiSessionInfo,
	PiStatePayload,
	PiStreamMessage,
	PiThinkingCapabilities,
	PiToolInfo,
} from "./pi";
import type { ProjectSummary } from "./session";

export type PiServerMessage =
	// Pi Coding Agent
	| { type: "pi_chat_started"; data: boolean; requestId?: string }
	| { type: "pi_steered"; data: boolean; requestId?: string }
	| { type: "pi_followed_up"; data: boolean; requestId?: string }
	| { type: "pi_aborted"; data: boolean; requestId?: string }
	| {
			type: "pi_steering_mode_set";
			data: { mode: "all" | "one-at-a-time" };
			requestId?: string;
	  }
	| {
			type: "pi_follow_up_mode_set";
			data: { mode: "all" | "one-at-a-time" };
			requestId?: string;
	  }
	| { type: "pi_auto_retry_set"; data: boolean; requestId?: string }
	| { type: "pi_retry_aborted"; data: boolean; requestId?: string }
	| { type: "pi_state"; data: PiStatePayload; requestId?: string }
	| {
			type: "pi_models";
			/** Every model Pi offers here, as `pi --list-models` prints them. */
			data: PiModelPayload[];
			selected: PiSelectedModelPayload[];
			defaultModel: PiDefaultModelPayload | null;
			requestId?: string;
	  }
	| { type: "pi_model_set"; data: PiModelPayload | null; isScoped?: boolean; requestId?: string }
	| { type: "pi_thinking_level"; data: { level: string }; requestId?: string }
	| { type: "pi_sessions"; data: PiSessionInfo[]; hasMore?: boolean; nextCursor?: string; requestId?: string }
	| { type: "pi_projects"; data: ProjectSummary[]; requestId?: string }
	| { type: "pi_session_created"; data: boolean; requestId?: string }
	| { type: "pi_session_switched"; data: boolean; requestId?: string }
	| { type: "pi_session_deleted"; data: boolean; requestId?: string }
	| { type: "pi_session_stats"; data: any; requestId?: string }
	| {
			type: "pi_modified_files";
			data: Array<{ file: string; additions: number; deletions: number }>;
			requestId?: string;
	  }
	| { type: "pi_messages"; data: any[]; requestId?: string }
	| { type: "pi_session_messages"; data: any[]; requestId?: string; hasMore?: boolean; nextCursor?: string }
	| {
			type: "pi_subagent_invocation";
			data: import("./pi").PiSubagentInvocationPayload | null;
			requestId?: string;
	  }
	| { type: "pi_session_name_set"; data: boolean; requestId?: string }
	| {
			type: "pi_fork_result";
			data: { text?: string; cancelled: boolean };
			requestId?: string;
	  }
	| {
			type: "pi_fork_messages";
			data: PiForkMessagePayload[];
			requestId?: string;
	  }
	| {
			type: "pi_tree_navigated";
			data: { editorText?: string; cancelled: boolean; aborted?: boolean };
			requestId?: string;
	  }
	| { type: "pi_commands"; data: PiCommandPayload[]; requestId?: string }
	| { type: "pi_compacted"; data: any; requestId?: string }
	| { type: "pi_auto_compaction_set"; data: boolean; requestId?: string }
	| { type: "pi_export_result"; data: { path: string; format?: string }; requestId?: string }
	| { type: "pi_jsonl_imported"; data: { success: boolean }; requestId?: string }
	| { type: "pi_system_prompt"; data: { systemPrompt: string }; requestId?: string }
	| { type: "pi_settings"; data: Record<string, any>; requestId?: string }
	| { type: "pi_settings_updated"; data: boolean; requestId?: string }
	| { type: "pi_instance_disposed"; data: boolean; requestId?: string }
	| { type: "pi_extension_ui_responded"; data: boolean; requestId?: string }
	| { type: "pi_stream"; data: PiStreamMessage; sessionId: string }
	// Pi Tool Management (responses)
	| { type: "pi_tools"; data: (PiToolInfo & { active: boolean })[]; requestId?: string }
	| { type: "pi_active_tools"; data: string[]; requestId?: string }
	| { type: "pi_active_tools_set"; data: string[]; requestId?: string }
	// Pi Model Capabilities (responses)
	| { type: "pi_thinking_capabilities"; data: PiThinkingCapabilities; requestId?: string }
	| { type: "pi_all_models"; data: PiModelPayload[]; requestId?: string }
	| {
			type: "pi_models_refreshed";
			data: PiModelPayload[];
			selected: PiSelectedModelPayload[];
			defaultModel: PiDefaultModelPayload | null;
			requestId?: string;
	  }
	// Pi Granular Abort (responses)
	| { type: "pi_compaction_aborted"; data: boolean; requestId?: string }
	| { type: "pi_branch_summary_aborted"; data: boolean; requestId?: string }
	| { type: "pi_bash_aborted"; data: boolean; requestId?: string }
	// Pi Queue Management (responses)
	| { type: "pi_queue_cleared"; data: PiQueueState; requestId?: string }
	| { type: "pi_queue"; data: PiQueueState; requestId?: string }
	// Pi Misc (responses)
	| { type: "pi_last_assistant_text"; data: { text: string | null }; requestId?: string }
	| {
			type: "pi_bash_result";
			data: {
				output: string;
				exitCode: number | null;
				cancelled: boolean;
				truncated: boolean;
				fullOutputPath?: string | null;
				error?: string;
			};
			requestId?: string;
	  }
	// Pi Label Management
	| {
			type: "pi_label_set";
			data: { success: boolean; entryId?: string; label?: string | null; error?: string };
			requestId?: string;
	  }
	| { type: "pi_label"; data: { entryId: string; label: string | null }; requestId?: string }
	| { type: "pi_labels"; data: Array<{ entryId: string; label: string }>; requestId?: string }
	// Pi Tree & Custom Messages
	| { type: "pi_tree"; data: { nodes: any[]; leafId: string | null; error?: string }; requestId?: string }
	| { type: "pi_custom_message_sent"; data: { success: boolean; error?: string }; requestId?: string };
