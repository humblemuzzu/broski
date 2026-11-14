/** One frame of every kind in `FRAME_KINDS`: recorded where a scenario has one, written out where none does. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { type FrameKey, frameKey } from "./frame-kinds";
import { failure, ids } from "./frames";

function recorded(key: FrameKey): SDKMessage {
	for (const scenario of frameScenarios()) {
		const found = readFrameFixture(scenario).find((frame) => frameKey(frame) === key);
		if (found) return found;
	}
	throw new Error(`no recorded frame of kind ${key}`);
}

export const SAMPLES: Readonly<Record<FrameKey, SDKMessage>> = {
	assistant: recorded("assistant"),
	user: recorded("user"),
	stream_event: recorded("stream_event"),
	"result/success": recorded("result/success"),
	"result/error_during_execution": recorded("result/error_during_execution"),
	"result/error_max_turns": failure({ subtype: "error_max_turns" }),
	"result/error_max_budget_usd": failure({ subtype: "error_max_budget_usd" }),
	"result/error_max_structured_output_retries": failure({ subtype: "error_max_structured_output_retries" }),
	"system/init": recorded("system/init"),
	"system/status": recorded("system/status"),
	"system/compact_boundary": recorded("system/compact_boundary"),
	"system/api_retry": recorded("system/api_retry"),
	"system/informational": recorded("system/informational"),
	"system/notification": { type: "system", subtype: "notification", key: "k", text: "t", priority: "low", ...ids() },
	"system/local_command_output": { type: "system", subtype: "local_command_output", content: "c", ...ids() },
	"system/model_refusal_fallback": {
		type: "system",
		subtype: "model_refusal_fallback",
		trigger: "refusal",
		direction: "retry",
		original_model: "a",
		fallback_model: "b",
		request_id: null,
		content: "",
		...ids(),
	},
	"system/model_refusal_no_fallback": recorded("system/model_refusal_no_fallback"),
	"system/mirror_error": {
		type: "system",
		subtype: "mirror_error",
		error: "e",
		key: { projectKey: "p", sessionId: "s" },
		...ids(),
	},
	"system/worker_shutting_down": { type: "system", subtype: "worker_shutting_down", reason: "host_exit", ...ids() },
	"system/plugin_install": { type: "system", subtype: "plugin_install", status: "failed", ...ids() },
	"system/session_writes_lost": {
		type: "system",
		subtype: "session_writes_lost",
		error_code: "ENOSPC",
		lost: ["transcript"],
		transcript_session_ids: ["s"],
		...ids(),
	},
	"system/permission_denied": {
		type: "system",
		subtype: "permission_denied",
		tool_name: "Bash",
		tool_use_id: "toolu_1",
		message: "no",
		...ids(),
	},
	"system/task_started": recorded("system/task_started"),
	"system/task_progress": recorded("system/task_progress"),
	tool_progress: {
		type: "tool_progress",
		tool_use_id: "toolu_1",
		tool_name: "Bash",
		parent_tool_use_id: null,
		elapsed_time_seconds: 1,
		...ids(),
	},
	prompt_suggestion: { type: "prompt_suggestion", suggestion: "go on", ...ids() },
	rate_limit_event: { type: "rate_limit_event", rate_limit_info: { status: "allowed" }, ...ids() },
	conversation_reset: {
		type: "conversation_reset",
		new_conversation_id: "22222222-3333-4444-8555-666666666666",
		...ids(),
	},
	"system/session_state_changed": recorded("system/session_state_changed"),
	"system/commands_changed": { type: "system", subtype: "commands_changed", commands: [], ...ids() },
	"system/background_tasks_changed": recorded("system/background_tasks_changed"),
	"system/task_updated": recorded("system/task_updated"),
	"system/task_notification": recorded("system/task_notification"),
	"system/thinking_tokens": recorded("system/thinking_tokens"),
	"system/hook_started": {
		type: "system",
		subtype: "hook_started",
		hook_id: "h",
		hook_name: "n",
		hook_event: "PreToolUse",
		...ids(),
	},
	"system/hook_progress": {
		type: "system",
		subtype: "hook_progress",
		hook_id: "h",
		hook_name: "n",
		hook_event: "PreToolUse",
		stdout: "",
		stderr: "",
		output: "",
		...ids(),
	},
	"system/hook_response": {
		type: "system",
		subtype: "hook_response",
		hook_id: "h",
		hook_name: "n",
		hook_event: "PreToolUse",
		output: "",
		stdout: "",
		stderr: "",
		outcome: "success",
		...ids(),
	},
	"system/memory_recall": { type: "system", subtype: "memory_recall", mode: "select", memories: [], ...ids() },
	"system/files_persisted": {
		type: "system",
		subtype: "files_persisted",
		files: [],
		failed: [],
		processed_at: "2026-11-01T00:00:00.000Z",
		...ids(),
	},
	"system/elicitation_complete": recorded("system/elicitation_complete"),
	"system/control_request_progress": {
		type: "system",
		subtype: "control_request_progress",
		request_id: "r",
		status: "started",
		...ids(),
	},
	tool_use_summary: { type: "tool_use_summary", summary: "s", preceding_tool_use_ids: [], ...ids() },
	auth_status: { type: "auth_status", isAuthenticating: false, output: [], ...ids() },
};
