/** Lane B · system frames shown as notices and extensions (`rate_limit`). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import { compactionEvents } from "./compaction";
import {
	informationalNotice,
	localCommandNotice,
	mirrorErrorNotice,
	notificationNotice,
	pluginInstallNotice,
	refusalFallbackNotice,
	refusalNoFallbackNotice,
	shuttingDownNotice,
} from "./notices";
import type { MapperState } from "./state";
import { taskProgressEvents, taskStartedEvents } from "./tool-calls";
import { wireToolCallId } from "./wire-id";

/** A tool call the CLI refused without asking is `denied`, not `failed`, when its result arrives. */
function noteDenial(state: MapperState, toolUseId: unknown): MappedEvent[] {
	const id = wireToolCallId(toolUseId);
	if (id !== undefined && state.openTools.has(id)) state.denied.add(id);
	return [];
}

/** `init` opens a turn; the model it names is what a context window is read for. */
function noteInit(state: MapperState, model: string): MappedEvent[] {
	state.model = model;
	state.turnUnderway = true;
	return [];
}

/**
 * The host owns runs, asks, the queue, the model, the mode and the catalogues, so `init`, `session_state_changed`,
 * `command_lifecycle`, `commands_changed` and the permission mode of `status` are theirs. What is left is shown here.
 */
export function systemEvents(state: MapperState, frame: Extract<SDKMessage, { type: "system" }>): MappedEvent[] {
	switch (frame.subtype) {
		case "init":
			return noteInit(state, frame.model);
		case "status":
		case "compact_boundary":
			return compactionEvents(state, frame);
		case "permission_denied":
			return noteDenial(state, frame.tool_use_id);
		case "task_started":
			return taskStartedEvents(state, frame);
		case "task_progress":
			return taskProgressEvents(state, frame);
		case "informational":
			return informationalNotice(frame);
		case "notification":
			return notificationNotice(frame);
		case "local_command_output":
			return localCommandNotice(frame);
		case "model_refusal_fallback":
			return refusalFallbackNotice(frame);
		case "model_refusal_no_fallback":
			return refusalNoFallbackNotice(frame);
		case "mirror_error":
			return mirrorErrorNotice(frame);
		case "worker_shutting_down":
			return shuttingDownNotice(frame);
		case "plugin_install":
			return pluginInstallNotice(frame);
		case "api_retry": // `retryEvents` reads every frame, this one included
		case "hook_started":
		case "hook_progress":
		case "hook_response":
		case "session_state_changed":
		case "background_tasks_changed":
		case "commands_changed":
		case "task_updated":
		case "task_notification":
		case "thinking_tokens":
		case "memory_recall":
		case "files_persisted":
		case "elicitation_complete":
		case "control_request_progress":
			return [];
		default:
			return unreachable(frame);
	}
}

/** A subtype the SDK adds later fails the type check here, and is ignored at run time (frames may be newer than the types). */
function unreachable(_frame: never): MappedEvent[] {
	return [];
}
