/** Pi's `AssistantMessageEvent`s as the stream tests feed them, and the record a stream becomes inside a run. */

import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import type { ToolCallIds } from "../../backends/pi/ids";
import type { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import { toolFinished } from "../../backends/pi/mapping/tool-items";
import type { AgentEvent, SinkRecord } from "../../contract";
import { assistant, records, validEvents } from "./mapping_fixtures";

export type Update = AssistantMessageEvent;

export function textStart(contentIndex: number, partial: AssistantMessage = assistant([])): Update {
	return { type: "text_start", contentIndex, partial };
}
export function textDelta(contentIndex: number, delta: string): Update {
	return { type: "text_delta", contentIndex, delta, partial: assistant([]) };
}
export function textEnd(contentIndex: number, content: string): Update {
	return { type: "text_end", contentIndex, content, partial: assistant([]) };
}
export function thinkingStart(contentIndex: number): Update {
	return { type: "thinking_start", contentIndex, partial: assistant([]) };
}
export function thinkingDelta(contentIndex: number, delta: string): Update {
	return { type: "thinking_delta", contentIndex, delta, partial: assistant([]) };
}
export function thinkingEnd(contentIndex: number, content: string): Update {
	return { type: "thinking_end", contentIndex, content, partial: assistant([]) };
}
export function callStart(contentIndex: number, partial: AssistantMessage): Update {
	return { type: "toolcall_start", contentIndex, partial };
}
export function callEnd(contentIndex: number, call: ToolCall): Update {
	return { type: "toolcall_end", contentIndex, toolCall: call, partial: assistant([call]) };
}

export function feed(stream: AssistantStream, updates: readonly Update[]): AgentEvent[] {
	return validEvents(updates.flatMap((update) => stream.update(update)));
}

/** The stream as the bridge would record it: inside a run, every call finished, then the run's end. */
export function inRun(
	events: readonly AgentEvent[],
	tools: ToolCallIds,
	piCallIds: readonly string[] = [],
): SinkRecord[] {
	const finishes = piCallIds.map((id) => toolFinished(id, "completed", { content: [], fileChanges: [] }, tools));
	return records([
		{ type: "run_started", runId: "run-1", trigger: "prompt" },
		...events,
		...finishes,
		{ type: "run_finished", runId: "run-1", outcome: { kind: "completed" } },
	]);
}
