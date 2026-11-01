/** Lane B · a `tool_use` block as `tool_started`, with its title, a subagent's `child_session` (D20), progress. */

import type {
	SDKTaskProgressMessage,
	SDKTaskStartedMessage,
	SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { MAX_TEXT_CHARS, type ToolCallId, type ToolOutcome, type ToolResult } from "../../../contract";
import { clip, fitsId, nameOr } from "../bounds";
import { childRef, toolCallId } from "../ids";
import { boundedJson } from "../json";
import type { MappedEvent } from "../ports/mapping";
import { phoneLine } from "./phone-text";
import { fanOut, nestsIn, type Placement } from "./routing";
import type { MapperState } from "./state";
import { toolTitle } from "./tool-titles";

const UNNAMED_TOOL = "tool";
const AGENT_TASK = "local_agent";

export interface ToolUse {
	readonly id: string;
	readonly name: string;
	readonly input: unknown;
}

/** One `tool_use` block of the message `messageId`. A call that already started (a resent frame) starts nothing. */
export function startTool(state: MapperState, block: ToolUse, messageId: string, placement: Placement): MappedEvent[] {
	const id = toolCallId(block.id);
	if (id === undefined || state.startedTools.has(id) || placement.streams.length === 0) return [];
	state.startedTools.add(id);
	const known = fitsId(messageId) ? messageId : undefined;
	state.openTools.set(id, {
		name: block.name,
		messageId: known,
		input: block.input,
		streams: placement.streams,
		progress: undefined,
		childLinked: false,
	});
	const title = toolTitle(block.name, block.input);
	const input = boundedJson(block.input);
	return fanOut(placement.streams, (stream) => ({
		type: "tool_started",
		toolCallId: id,
		name: nameOr(block.name, UNNAMED_TOOL),
		...(title !== undefined && { title }),
		input,
		...(known !== undefined && { messageId: known }),
		...(nestsIn(placement, stream) && placement.parent !== undefined && { parentToolCallId: placement.parent }),
	}));
}

/** The call's end, in every stream it was shown in. */
export function endTool(state: MapperState, id: ToolCallId, outcome: ToolOutcome, result: ToolResult): MappedEvent[] {
	const open = state.openTools.get(id);
	if (open === undefined) return [];
	state.openTools.delete(id);
	state.denied.delete(id);
	return fanOut(open.streams, () => ({
		type: "tool_finished",
		toolCallId: id,
		outcome,
		result,
	}));
}

function progressUpdate(state: MapperState, id: ToolCallId, message: string): MappedEvent[] {
	const open = state.openTools.get(id);
	if (open === undefined || open.progress === message) return [];
	open.progress = message;
	return fanOut(open.streams, () => ({
		type: "tool_updated",
		toolCallId: id,
		update: { kind: "progress", message },
	}));
}

function elapsedText(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** Long tool runs: "Running · 12s". A heartbeat only says the process is alive. */
export function toolProgressEvents(state: MapperState, frame: SDKToolProgressMessage): MappedEvent[] {
	const id = toolCallId(frame.tool_use_id);
	if (id === undefined || frame.heartbeat === true) return [];
	return progressUpdate(state, id, `Running · ${elapsedText(frame.elapsed_time_seconds)}`);
}

/** A task's own progress line (`summary`, else `description`) on the tool call that started it. */
export function taskProgressEvents(state: MapperState, frame: SDKTaskProgressMessage): MappedEvent[] {
	const id = frame.tool_use_id === undefined ? undefined : toolCallId(frame.tool_use_id);
	const line = phoneLine(frame.summary ?? frame.description, MAX_TEXT_CHARS);
	return id === undefined || line === "" ? [] : progressUpdate(state, id, clip(line, MAX_TEXT_CHARS));
}

/**
 * A subagent task names the tool call that started it: that call runs in the child session
 * `<sessionId>/<agentId>` (the task id is the frames' `agent_id`), once, in every stream the call is shown in.
 */
export function taskStartedEvents(state: MapperState, frame: SDKTaskStartedMessage): MappedEvent[] {
	if (frame.task_type !== AGENT_TASK || frame.tool_use_id === undefined) return [];
	const id = toolCallId(frame.tool_use_id);
	const open = id === undefined ? undefined : state.openTools.get(id);
	const sessionId = childRef(state.seed.sessionId, frame.task_id);
	if (id === undefined || open === undefined || open.childLinked || sessionId === undefined) return [];
	open.childLinked = true;
	return fanOut(open.streams, () => ({
		type: "tool_updated",
		toolCallId: id,
		update: {
			kind: "child_session",
			session: { backend: "claude-code", sessionId },
		},
	}));
}
