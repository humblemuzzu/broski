/** Lane B · a `tool_use` block as `tool_started`, with its title, a subagent's `child_session` (D20), progress. */

import type {
	SDKTaskProgressMessage,
	SDKTaskStartedMessage,
	SDKToolProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ToolCallId, ToolOutcome, ToolResult } from "../../../contract";
import { nameOr } from "../bounds";
import { childRef } from "../ids";
import { boundedJson } from "../json";
import type { MappedEvent } from "../ports/mapping";
import { phoneLine } from "./phone-text";
import { fanOut, nestsIn, type Placement } from "./routing";
import type { MapperState } from "./state";
import { toolTitle } from "./tool-titles";
import { wireId, wireToolCallId } from "./wire-id";

const UNNAMED_TOOL = "tool";
const AGENT_TASK = "local_agent";
const PROGRESS_CHARS = 300;

export interface ToolUse {
	readonly id: unknown;
	readonly name: unknown;
	readonly input: unknown;
}

/**
 * One `tool_use` block of the message `messageId` (an id that fits). A call that already started (a resent frame)
 * starts nothing.
 */
export function startTool(state: MapperState, block: ToolUse, messageId: string, placement: Placement): MappedEvent[] {
	const id = wireToolCallId(block.id);
	if (id === undefined || state.startedTools.has(id) || placement.streams.length === 0) return [];
	state.startedTools.add(id);
	const name = typeof block.name === "string" ? block.name : "";
	state.openTools.set(id, {
		name,
		messageId,
		input: block.input,
		streams: placement.streams,
		progress: undefined,
		childLinked: false,
	});
	const title = toolTitle(name, block.input);
	const input = boundedJson(block.input);
	return fanOut(placement.streams, (stream) => ({
		type: "tool_started",
		toolCallId: id,
		name: nameOr(name, UNNAMED_TOOL),
		...(title !== undefined && { title }),
		input,
		messageId,
		...(nestsIn(placement, stream) && placement.parent !== undefined && { parentToolCallId: placement.parent }),
	}));
}

/** The call's end, in every stream it was shown in. */
export function endTool(state: MapperState, id: ToolCallId, outcome: ToolOutcome, result: ToolResult): MappedEvent[] {
	const open = state.openTools.get(id);
	if (open === undefined) return [];
	state.openTools.delete(id);
	state.denied.delete(id);
	return fanOut(open.streams, () => ({ type: "tool_finished", toolCallId: id, outcome, result }));
}

function progressUpdate(state: MapperState, id: ToolCallId, message: string): MappedEvent[] {
	const open = state.openTools.get(id);
	if (open === undefined || open.progress === message) return [];
	open.progress = message;
	return fanOut(open.streams, () => ({ type: "tool_updated", toolCallId: id, update: { kind: "progress", message } }));
}

function elapsedText(seconds: number): string | undefined {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
	const whole = Math.max(0, Math.floor(seconds));
	return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** Long tool runs: "Running · 12s". A heartbeat only says the process is alive. */
export function toolProgressEvents(state: MapperState, frame: SDKToolProgressMessage): MappedEvent[] {
	const id = wireToolCallId(frame.tool_use_id);
	const elapsed = elapsedText(frame.elapsed_time_seconds);
	if (id === undefined || elapsed === undefined || frame.heartbeat === true) return [];
	return progressUpdate(state, id, `Running · ${elapsed}`);
}

/** A task's own progress line (`summary`, else `description`) on the tool call that started it. */
export function taskProgressEvents(state: MapperState, frame: SDKTaskProgressMessage): MappedEvent[] {
	const id = wireToolCallId(frame.tool_use_id);
	const line = phoneLine(String(frame.summary ?? frame.description ?? ""), PROGRESS_CHARS);
	return id === undefined || line === "" ? [] : progressUpdate(state, id, line);
}

/**
 * A subagent task names the tool call that started it: that call runs in the child session
 * `<sessionId>/<agentId>` (the task id is the frames' `agent_id`), once, in every stream the call is shown in.
 */
export function taskStartedEvents(state: MapperState, frame: SDKTaskStartedMessage): MappedEvent[] {
	if (frame.task_type !== AGENT_TASK) return [];
	const id = wireToolCallId(frame.tool_use_id);
	const taskId = wireId(frame.task_id);
	const open = id === undefined ? undefined : state.openTools.get(id);
	const sessionId = taskId === undefined ? undefined : childRef(state.seed.sessionId, taskId);
	if (id === undefined || open === undefined || open.childLinked || sessionId === undefined) return [];
	open.childLinked = true;
	return fanOut(open.streams, () => ({
		type: "tool_updated",
		toolCallId: id,
		update: { kind: "child_session", session: { backend: "claude-code", sessionId } },
	}));
}
