/**
 * The `assistantMessageEvent`s of `message_update` lines as `pi --mode rpc` writes them (no `partial`; a
 * `toolcall_start` names its call), read through the adapter's own schema, and the record a stream becomes in a run.
 */

import type { ToolCallIds } from "../../backends/pi/ids";
import type { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import type { StreamEvent } from "../../backends/pi/mapping/stream-event";
import { toolFinished } from "../../backends/pi/mapping/tool-items";
import type { AssistantMessage, ToolCall } from "../../backends/pi/messages";
import type { AgentEvent, SinkRecord } from "../../contract";
import { piEvent, records, validEvents } from "./mapping_fixtures";

export type Update = StreamEvent | { readonly type: "ignored" };

/** One `assistantMessageEvent`, written as Pi writes it. */
export function streamEvent(raw: Record<string, unknown>): Update {
	return piEvent({ type: "message_update", assistantMessageEvent: raw }).assistantMessageEvent;
}

export function textStart(contentIndex: number): Update {
	return streamEvent({ type: "text_start", contentIndex });
}
export function textDelta(contentIndex: number, delta: string): Update {
	return streamEvent({ type: "text_delta", contentIndex, delta });
}
export function textEnd(contentIndex: number, content: string): Update {
	return streamEvent({ type: "text_end", contentIndex, content });
}
export function thinkingStart(contentIndex: number): Update {
	return streamEvent({ type: "thinking_start", contentIndex });
}
export function thinkingDelta(contentIndex: number, delta: string): Update {
	return streamEvent({ type: "thinking_delta", contentIndex, delta });
}
export function thinkingEnd(contentIndex: number, content: string): Update {
	return streamEvent({ type: "thinking_end", contentIndex, content });
}
/** Pi names the call at `contentIndex` of the message so far, empty when the provider has not sent it yet. */
export function callStart(contentIndex: number, sofar: AssistantMessage): Update {
	const block = sofar.content[contentIndex];
	const call = block?.type === "toolCall" ? block : { id: "", name: "" };
	return streamEvent({ type: "toolcall_start", contentIndex, id: call.id, toolName: call.name });
}
/** `call` as Pi writes it, with whatever else it carries (an `argumentsError`). */
export function callEnd(contentIndex: number, call: ToolCall | Record<string, unknown>): Update {
	return streamEvent({ type: "toolcall_end", contentIndex, toolCall: call });
}

/** What the stream makes of updates, as the event bridge hands them over: an ignored one never reaches it. */
export function updateOf(stream: AssistantStream, update: Update): AgentEvent[] {
	return update.type === "ignored" ? [] : stream.update(update);
}

export function feed(stream: AssistantStream, updates: readonly Update[]): AgentEvent[] {
	return validEvents(updates.flatMap((update) => updateOf(stream, update)));
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
