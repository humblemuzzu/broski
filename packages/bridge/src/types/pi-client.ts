import type { FileAttachment } from "./common";

export type PiClientMessage =
	// Pi Coding Agent
	| {
			type: "pi_chat";
			prompt: string;
			projectPath?: string;
			fileAttachments?: FileAttachment[];
			streamingBehavior?: "steer" | "followUp";
	  }
	| { type: "pi_steer"; message: string; projectPath?: string; fileAttachments?: FileAttachment[] }
	| { type: "pi_follow_up"; message: string; projectPath?: string; fileAttachments?: FileAttachment[] }
	| { type: "pi_abort"; projectPath?: string }
	| {
			type: "pi_set_steering_mode";
			mode: "all" | "one-at-a-time";
			projectPath?: string;
	  }
	| {
			type: "pi_set_follow_up_mode";
			mode: "all" | "one-at-a-time";
			projectPath?: string;
	  }
	| { type: "pi_set_auto_retry"; enabled: boolean; projectPath?: string }
	| { type: "pi_abort_retry"; projectPath?: string }
	| { type: "pi_get_state"; projectPath?: string }
	| { type: "pi_list_models"; projectPath?: string }
	| {
			type: "pi_set_model";
			provider: string;
			modelId: string;
			projectPath?: string;
	  }
	| { type: "pi_set_thinking_level"; level: string; projectPath?: string }
	| { type: "pi_cycle_thinking_level"; projectPath?: string }
	| { type: "pi_cycle_model"; projectPath?: string; direction?: "forward" | "backward" }
	| { type: "pi_list_sessions"; projectPath?: string; limit?: number; before?: string }
	| { type: "pi_list_projects" }
	| {
			type: "pi_new_session";
			projectPath?: string;
			name?: string;
			provider?: string;
			modelId?: string;
			thinkingLevel?: string;
	  }
	| { type: "pi_switch_session"; sessionPath: string; projectPath?: string }
	| { type: "pi_delete_session"; sessionPath: string; projectPath?: string }
	| { type: "pi_get_session_stats"; projectPath?: string }
	| { type: "pi_get_modified_files"; projectPath?: string }
	| { type: "pi_get_messages"; projectPath?: string }
	| { type: "pi_read_session_messages"; sessionPath?: string; sessionId?: string; limit?: number; before?: string }
	| { type: "pi_get_subagent_invocation"; parentSessionPath: string; toolCallId: string; requestId?: string }
	| { type: "pi_set_session_name"; name: string; projectPath?: string }
	| { type: "pi_fork"; entryId: string; projectPath?: string }
	| { type: "pi_get_fork_messages"; projectPath?: string }
	| {
			type: "pi_navigate_tree";
			targetId: string;
			summarize?: boolean;
			customInstructions?: string;
			replaceInstructions?: boolean;
			label?: string;
			projectPath?: string;
	  }
	| { type: "pi_list_commands"; projectPath?: string }
	| { type: "pi_compact"; customInstructions?: string; projectPath?: string }
	| { type: "pi_set_auto_compaction"; enabled: boolean; projectPath?: string }
	| { type: "pi_export_html"; outputPath?: string; projectPath?: string }
	| { type: "pi_export_jsonl"; outputPath?: string; projectPath?: string }
	| { type: "pi_import_jsonl"; inputPath: string; projectPath?: string }
	| { type: "pi_get_system_prompt"; projectPath?: string }
	| { type: "pi_get_settings"; projectPath?: string }
	| {
			type: "pi_set_settings";
			settings: Record<string, any>;
			projectPath?: string;
	  }
	| { type: "pi_dispose_instance"; projectPath?: string }
	| {
			type: "pi_extension_ui_response";
			id: string;
			value?: any;
			confirmed?: boolean;
			cancelled?: boolean;
			projectPath?: string;
	  }
	// Pi Tool Management
	| { type: "pi_get_tools"; projectPath?: string }
	| { type: "pi_get_active_tools"; projectPath?: string }
	| { type: "pi_set_active_tools"; toolNames: string[]; projectPath?: string }
	// Pi Model Capabilities
	| { type: "pi_get_thinking_capabilities"; projectPath?: string }
	| { type: "pi_list_all_models"; projectPath?: string }
	| { type: "pi_refresh_models"; projectPath?: string }
	// Pi Granular Abort
	| { type: "pi_abort_compaction"; projectPath?: string }
	| { type: "pi_abort_branch_summary"; projectPath?: string }
	| { type: "pi_abort_bash"; projectPath?: string }
	// Pi Bash Execution
	| { type: "pi_execute_bash"; command: string; excludeFromContext?: boolean; projectPath?: string }
	// Pi Queue Management
	| { type: "pi_clear_queue"; projectPath?: string }
	| { type: "pi_get_queue"; projectPath?: string }
	// Pi Misc
	| { type: "pi_get_last_assistant_text"; projectPath?: string }
	// Pi Label Management
	| { type: "pi_set_label"; entryId: string; label?: string; projectPath?: string }
	| { type: "pi_get_label"; entryId: string; projectPath?: string }
	| { type: "pi_get_labels"; projectPath?: string }
	// Pi Tree & Custom Messages
	| { type: "pi_get_tree"; projectPath?: string }
	| {
			type: "pi_send_custom_message";
			customType: string;
			content?: string;
			display?: boolean;
			details?: any;
			triggerTurn?: boolean;
			deliverAs?: "steer" | "followUp" | "nextTurn";
			projectPath?: string;
	  };
