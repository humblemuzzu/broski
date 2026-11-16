/**
 * Every `SDKMessage` variant, mapped or ignored, and why. The table is typed over the union, so an
 * SDK that adds a variant fails the type check here until someone decides what it shows.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type KeyOf<Frame> = Frame extends {
	type: infer T extends string;
	subtype: infer S extends string;
}
	? `${T}/${S}`
	: Frame extends { type: infer T extends string }
		? T
		: never;

export type FrameKey = KeyOf<SDKMessage>;

export type Disposition = { readonly shows: string } | { readonly ignored: string };

const HOST = "the host's";
const NO_HOME = "no contract home";

export const FRAME_KINDS: Readonly<Record<FrameKey, Disposition>> = {
	assistant: {
		shows:
			"block_started/block_finished, tool_started; a synthetic error frame as notice(error); supersedes as messages_retracted",
	},
	user: {
		shows: "tool_result blocks as tool_finished; a prompt this host did not send as user_message",
	},
	stream_event: {
		shows: "text and thinking blocks as block_started/block_delta/block_finished",
	},
	"result/success": {
		shows: "usage_updated; a compaction still open ends. The outcome is turnOutcome, the host's run_finished",
	},
	"result/error_during_execution": { shows: "as result/success" },
	"result/error_max_turns": { shows: "as result/success" },
	"result/error_max_budget_usd": { shows: "as result/success" },
	"result/error_max_structured_output_retries": { shows: "as result/success" },
	"system/init": {
		ignored: `${HOST}: model, mode, catalogues; the mapper only reads the model and that a turn began`,
	},
	"system/status": {
		shows: "status compacting as compaction_started; status null with compact_result as compaction_finished",
	},
	"system/compact_boundary": {
		shows: "compaction_finished with the token counts",
	},
	"system/api_retry": {
		shows: "retry_scheduled; retry_finished from the next frame of the main loop",
	},
	"system/informational": { shows: "notice" },
	"system/notification": { shows: "notice" },
	"system/local_command_output": { shows: "activity(command) with the output as text" },
	"system/model_refusal_fallback": {
		shows: "notice(warning) and messages_retracted for retracted_message_uuids",
	},
	"system/model_refusal_no_fallback": {
		shows: "notice(warning); the error outcome comes from the result",
	},
	"system/mirror_error": { shows: "notice(error)" },
	"system/worker_shutting_down": { shows: "notice(warning)" },
	"system/plugin_install": { shows: "notice(warning) when an install failed" },
	"system/session_writes_lost": { shows: "notice(error) naming what was not saved and why" },
	"system/permission_denied": {
		shows: "marks the tool call, whose result is then denied",
	},
	"system/task_started": {
		shows: "tool_updated(child_session) on the Agent call that started a subagent; the task is kept for its end",
	},
	"system/task_progress": {
		shows: "tool_updated(progress) on the call that started the task",
	},
	tool_progress: { shows: "tool_updated(progress) while the call runs" },
	prompt_suggestion: { ignored: "the host does not ask for prompt suggestions" },
	rate_limit_event: { shows: "extension(rate_limit)" },
	conversation_reset: { shows: "session_replaced" },
	"system/session_state_changed": {
		ignored: `${HOST}: idle ends the run, requires_action is the desk's`,
	},
	"system/commands_changed": {
		ignored: `${HOST}: the command catalogue is invalidated, not the stream`,
	},
	"system/background_tasks_changed": {
		shows: "background_tasks_changed, ambient tasks left out",
	},
	"system/task_updated": {
		ignored: "no event of its own; a task it moves to the background later ends as an activity",
	},
	"system/task_notification": {
		shows: "activity for a task in the background; a foreground task ends with its tool call's result",
	},
	"system/thinking_tokens": {
		ignored: "a spinner estimate, not billable, and block_delta carries text only",
	},
	"system/hook_started": { ignored: "the host does not ask for hook events" },
	"system/hook_progress": { ignored: "the host does not ask for hook events" },
	"system/hook_response": { ignored: "the host does not ask for hook events" },
	"system/memory_recall": {
		ignored: `${NO_HOME}; a notice every turn would be noise`,
	},
	"system/files_persisted": { ignored: NO_HOME },
	"system/elicitation_complete": {
		ignored: `${HOST}: it withdraws an URL ask, which is the desk's`,
	},
	"system/control_request_progress": {
		ignored: "progress of a control request, not of the run",
	},
	tool_use_summary: {
		ignored: "a model-written summary of tool calls (CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES); progress would be a lie",
	},
	auth_status: { ignored: "login flows, which this adapter never starts" },
};

/** The key of a frame in `FRAME_KINDS`, for a frame of any shape; frames the SDK's types do not declare have none there. */
export function frameKey(frame: { readonly type: string; readonly subtype?: unknown }): string {
	return typeof frame.subtype === "string" ? `${frame.type}/${frame.subtype}` : frame.type;
}

/** Frames `sdk.mjs` passes through that `SDKMessage` does not declare; the mapper ignores them. */
export const UNDECLARED_FRAMES: Readonly<Record<string, string>> = {
	command_lifecycle: `${HOST}: queue_changed and send tracking (asCommandLifecycle)`,
	active_goal: `${NO_HOME}; /goal is not offered`,
	session_title_changed: "the store reads the title from the session file",
	turn_preempted: NO_HOME,
	model_fallback: NO_HOME,
	vcs_state_changed: NO_HOME,
	post_turn_summary: NO_HOME,
	task_summary: NO_HOME,
	session_metadata: NO_HOME,
	autocompact_state: NO_HOME,
};
