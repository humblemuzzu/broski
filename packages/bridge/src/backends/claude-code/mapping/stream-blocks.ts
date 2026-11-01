/**
 * Lane B · `stream_event` frames: `block_started`/`block_delta` for text and thinking. A tool call is not started
 * here: its `tool_started` waits for the `assistant` frame that holds the whole input (D51), so `input_json_delta`
 * says nothing.
 */

import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import { finishAllBlocks, finishBlock, growBlock, idOfBlock, startBlock } from "./blocks";
import { type Placement, placementOf } from "./routing";
import type { MapperState } from "./state";
import { wireId, wireIndex } from "./wire-id";

type StreamEvent = SDKPartialAssistantMessage["event"];

export function streamEvents(state: MapperState, frame: SDKPartialAssistantMessage): MappedEvent[] {
	const placement = placementOf(state, {
		agentId: undefined,
		parentToolUseId: frame.parent_tool_use_id,
	});
	const event = frame.event;
	switch (event.type) {
		case "message_start": {
			const messageId = wireId(event.message.id);
			state.streaming = messageId === undefined ? undefined : state.ledger(messageId);
			state.turnUnderway = true;
			return [];
		}
		case "content_block_start":
		case "content_block_delta":
		case "content_block_stop":
			return blockEvents(state, event, placement);
		case "message_stop": {
			const ledger = state.streaming;
			state.streaming = undefined;
			if (ledger === undefined) return [];
			const finished = finishAllBlocks(state, ledger.messageId);
			ledger.endAll();
			return finished;
		}
		case "message_delta":
			return [];
	}
}

function blockEvents(
	state: MapperState,
	event: Extract<
		StreamEvent,
		{
			type: "content_block_start" | "content_block_delta" | "content_block_stop";
		}
	>,
	placement: Placement,
): MappedEvent[] {
	const ledger = state.streaming;
	const index = wireIndex(event.index);
	if (ledger === undefined || index === undefined || placement.streams.length === 0) return [];
	const id = idOfBlock(ledger.messageId, index);
	switch (event.type) {
		case "content_block_start": {
			const block = event.content_block;
			if (block.type === "tool_use") ledger.announce(index, block.type, wireId(block.id));
			else ledger.announce(index, block.type);
			if (block.type !== "text" && block.type !== "thinking") return [];
			const started = startBlock(state, ledger.messageId, index, block.type, placement);
			const initial = block.type === "text" ? block.text : block.thinking;
			return id === undefined || typeof initial !== "string" || initial === ""
				? started
				: [...started, ...growBlock(state, id, block.type, initial)];
		}
		case "content_block_delta": {
			if (id === undefined) return [];
			const delta = event.delta;
			if (delta.type === "text_delta") return growBlock(state, id, "text", delta.text);
			return delta.type === "thinking_delta" ? growBlock(state, id, "thinking", delta.thinking) : [];
		}
		case "content_block_stop": {
			const announced = ledger.block(index);
			if (id === undefined || announced === undefined || announced.done) return [];
			announced.done = true;
			return finishBlock(state, id);
		}
	}
}
