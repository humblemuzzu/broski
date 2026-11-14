/** `assistant` frames (one block each): `block_finished`, `tool_started`, an aborted block. */

import type { SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MappedEvent } from "../ports/mapping";
import { finishBlock, idOfBlock, startBlock } from "./blocks";
import { noticeEvent } from "./notices";
import { fanOut, type Placement, placementOf } from "./routing";
import type { MapperState } from "./state";
import { startTool } from "./tool-calls";
import { wireId } from "./wire-id";

type Block = SDKAssistantMessage["message"]["content"][number];

/**
 * The block an `assistant` frame completes. A streamed block is open and finishes with this frame's whole text
 * (authoritative); a block the stream already finished, or that nothing streamed and has no text, says nothing more.
 */
function textBlock(
	state: MapperState,
	messageId: string,
	kind: "text" | "thinking",
	text: string,
	placement: Placement,
): MappedEvent[] {
	const claimed = state.ledger(messageId).claim(kind);
	const id = idOfBlock(messageId, claimed.index);
	if (id === undefined) return [];
	const wasDone = claimed.done;
	claimed.done = true;
	if (state.openBlocks.has(id)) return finishBlock(state, id, text);
	if (wasDone || text === "") return [];
	return [...startBlock(state, messageId, claimed.index, kind, placement), ...finishBlock(state, id, text)];
}

function blockEvents(state: MapperState, messageId: string, block: Block, placement: Placement): MappedEvent[] {
	switch (block.type) {
		case "text":
			return textBlock(state, messageId, "text", block.text, placement);
		case "thinking":
			return textBlock(state, messageId, "thinking", block.thinking, placement);
		case "tool_use":
			state.ledger(messageId).claim(block.type, wireId(block.id)).done = true;
			return startTool(state, block, messageId, placement);
		default:
			state.ledger(messageId).claim(block.type).done = true;
			return [];
	}
}

/** What a synthetic error frame (`error` set: an API failure the CLI wrote as an assistant turn) says, as a notice. */
function errorNotice(frame: SDKAssistantMessage, placement: Placement): MappedEvent[] {
	const text = frame.message.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
	return fanOut(placement.streams, () =>
		noticeEvent("error", text === "" ? `Claude Code reported an error: ${frame.error}` : text),
	);
}

export function assistantEvents(state: MapperState, frame: SDKAssistantMessage): MappedEvent[] {
	const messageId = wireId(frame.message.id);
	const placement = placementOf(state, {
		agentId: frame.agent_id,
		parentToolUseId: frame.parent_tool_use_id,
	});
	if (messageId === undefined || placement.streams.length === 0 || state.frameMessages.has(frame.uuid)) return [];
	state.rememberFrame(frame.uuid, messageId, placement.streams);
	if (frame.error !== undefined) return errorNotice(frame, placement);
	return frame.message.content.flatMap((block) => blockEvents(state, messageId, block, placement));
}
