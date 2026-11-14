/** The three things a text or thinking block does: start, grow, finish; each in every stream it is shown in. */

import { type BlockId, MAX_TEXT_CHARS } from "../../../contract";
import { clip, fitsId } from "../bounds";
import { blockId } from "../ids";
import type { MappedEvent } from "../ports/mapping";
import { fanOut, nestsIn, type Placement } from "./routing";
import type { MapperState } from "./state";
import { wireId, wireIndex } from "./wire-id";

type BlockKind = "text" | "thinking";

/** The block's id, or undefined when `<message.id>:<index>` or the message id does not fit an id. */
export function idOfBlock(messageId: unknown, index: unknown): BlockId | undefined {
	const message = wireId(messageId);
	const at = wireIndex(index);
	if (message === undefined || at === undefined) return undefined;
	const id = blockId(message, at);
	return fitsId(id) ? id : undefined;
}

export function startBlock(
	state: MapperState,
	messageId: string,
	index: number,
	kind: BlockKind,
	placement: Placement,
): MappedEvent[] {
	const id = idOfBlock(messageId, index);
	if (id === undefined || state.openBlocks.has(id) || placement.streams.length === 0) return [];
	state.openBlocks.set(id, {
		messageId,
		kind,
		streams: placement.streams,
		text: "",
	});
	return fanOut(placement.streams, (stream) => ({
		type: "block_started",
		blockId: id,
		messageId,
		kind,
		...(nestsIn(placement, stream) && placement.parent !== undefined && { parentToolCallId: placement.parent }),
	}));
}

/** `text` is cut to what the block can still hold, so the deltas always add up to what `finishBlock` says. */
export function growBlock(state: MapperState, id: BlockId, kind: BlockKind, text: string): MappedEvent[] {
	const open = state.openBlocks.get(id);
	if (open === undefined || open.kind !== kind) return [];
	const piece = clip(text, MAX_TEXT_CHARS - open.text.length);
	if (piece === "") return [];
	open.text += piece;
	return fanOut(open.streams, () => ({
		type: "block_delta",
		blockId: id,
		text: piece,
	}));
}

/** The block's whole text: `text` when a frame has it (it is authoritative), else what the deltas built. */
export function finishBlock(state: MapperState, id: BlockId, text?: string): MappedEvent[] {
	const open = state.openBlocks.get(id);
	if (open === undefined) return [];
	state.openBlocks.delete(id);
	const whole = text === undefined ? open.text : clip(text, MAX_TEXT_CHARS);
	return fanOut(open.streams, () => ({
		type: "block_finished",
		blockId: id,
		text: whole,
	}));
}

/** Every block still open, finished with its text so far. */
export function finishAllBlocks(state: MapperState, messageId?: string): MappedEvent[] {
	const events: MappedEvent[] = [];
	for (const [id, open] of [...state.openBlocks]) {
		if (messageId === undefined || open.messageId === messageId) events.push(...finishBlock(state, id));
	}
	return events;
}
