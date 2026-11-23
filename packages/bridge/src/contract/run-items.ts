import type { SinkRecord } from "./backend";
import type { ToolCallId } from "./ids";
import { MAX_RUN_ITEMS } from "./limits";
import type { ActiveRun, SessionSnapshot } from "./snapshot";
import type { ToolCallItem, TranscriptItem } from "./transcript";

/** The id a tool call's result item has when it comes from the live stream. */
function resultItemId(toolCallId: ToolCallId): string {
	return `${toolCallId}:result`;
}

/**
 * The items `record` finishes, in the live stream's ids: a user message, a finished block, a started
 * tool call, a tool result, an activity. `before` is the live state the record applies to.
 */
export function finishedItems(before: SessionSnapshot, record: Pick<SinkRecord, "at" | "event">): TranscriptItem[] {
	const { at, event } = record;
	switch (event.type) {
		case "user_message": {
			const { type: _type, messageId, ...message } = event;
			return [{ kind: "user_message", id: messageId, at, ...message }];
		}
		case "block_finished": {
			const block = before.blocks.find((open) => open.blockId === event.blockId);
			if (!block) return [];
			const { blockId, kind, text: _partial, ...rest } = block;
			return [{ kind: "block", id: blockId, at, block: kind, text: event.text, ...rest }];
		}
		case "tool_started": {
			const { type: _type, ...call } = event;
			return [{ kind: "tool_call", id: event.toolCallId, at, ...call }];
		}
		case "tool_finished": {
			const { type: _type, ...result } = event;
			return [{ kind: "tool_result", id: resultItemId(event.toolCallId), at, ...result }];
		}
		case "activity":
			return [{ kind: "activity", id: event.activityId, at, activity: event.activity }];
		default:
			return [];
	}
}

/** A tool call item as it stands when the call finishes: with the input and child session it learnt while running. */
export function completedCall(item: ToolCallItem, before: SessionSnapshot): ToolCallItem {
	const tool = before.tools.find((running) => running.toolCallId === item.toolCallId);
	if (!tool) return item;
	return {
		...item,
		...(tool.input !== undefined && { input: tool.input }),
		...(tool.childSession !== undefined && { childSession: tool.childSession }),
	};
}

/** `items` without the retracted messages' blocks and tool calls, and without those calls' results. */
export function withoutRetracted(items: readonly TranscriptItem[], messageIds: readonly string[]): TranscriptItem[] {
	const retracted = new Set(messageIds);
	const calls = new Set(
		items.flatMap((item) =>
			item.kind === "tool_call" && item.messageId !== undefined && retracted.has(item.messageId)
				? [item.toolCallId]
				: [],
		),
	);
	return items.filter((item) => {
		switch (item.kind) {
			case "block":
				return !retracted.has(item.messageId);
			case "tool_call":
			case "tool_result":
				return !calls.has(item.toolCallId);
			default:
				return true;
		}
	});
}

/** The active run after `record`. */
export function nextRun(run: ActiveRun, before: SessionSnapshot, record: Pick<SinkRecord, "at" | "event">): ActiveRun {
	const event = record.event;
	switch (event.type) {
		case "session_replaced":
			return { ...run, items: [], droppedItems: 0 };
		case "messages_retracted":
			return { ...run, items: withoutRetracted(run.items, event.messageIds) };
		case "tool_finished":
			return bounded({
				...run,
				items: [
					...run.items.map((item) =>
						item.kind === "tool_call" && item.toolCallId === event.toolCallId ? completedCall(item, before) : item,
					),
					...finishedItems(before, record),
				],
			});
		default: {
			const added = finishedItems(before, record);
			return added.length === 0 ? run : bounded({ ...run, items: [...run.items, ...added] });
		}
	}
}

function bounded(run: ActiveRun): ActiveRun {
	const excess = run.items.length - MAX_RUN_ITEMS;
	if (excess <= 0) return run;
	return { ...run, items: run.items.slice(excess), droppedItems: run.droppedItems + excess };
}
