/** An `assistant` transcript line: one content block of an API message, as the CLI writes it when the block is done. */

import { MAX_TEXT_CHARS } from "../../../contract";
import { clip, fitsId, nameOr } from "../bounds";
import { blockId, toolCallId } from "../ids";
import { boundedJson, isRecord } from "../json";
import { toolTitle } from "../mapping/tool-titles";
import type { MappedEvent } from "../ports/mapping";
import type { TranslatorState } from "./translate-state";

export function assistantEvents(state: TranslatorState, entry: Record<string, unknown>): MappedEvent[] {
	const message = entry.message;
	if (!isRecord(message) || typeof message.id !== "string" || !fitsId(message.id)) return [];
	if (!Array.isArray(message.content)) return [];
	const out: MappedEvent[] = [];
	const messageId = message.id;
	const first = firstIndex(state, messageId, entry.apiBlockIndex);
	message.content.forEach((block: unknown, position) => {
		if (!isRecord(block)) return;
		const index = first + position;
		state.noteIndex(messageId, index);
		blockEvents(state, out, messageId, index, block);
	});
	state.lastStop = typeof message.stop_reason === "string" ? message.stop_reason : undefined;
	return out;
}

function firstIndex(state: TranslatorState, messageId: string, apiBlockIndex: unknown): number {
	return typeof apiBlockIndex === "number" && Number.isInteger(apiBlockIndex) && apiBlockIndex >= 0
		? apiBlockIndex
		: state.fallbackIndex(messageId);
}

function blockEvents(
	state: TranslatorState,
	out: MappedEvent[],
	messageId: string,
	index: number,
	block: Record<string, unknown>,
): void {
	if (block.type === "text" || block.type === "thinking") {
		const text = block.type === "text" ? block.text : block.thinking;
		if (typeof text === "string" && text.trim() !== "") textBlock(state, out, messageId, index, block.type, text);
	} else if (block.type === "tool_use") {
		toolUse(state, out, messageId, block);
	}
}

function textBlock(
	state: TranslatorState,
	out: MappedEvent[],
	messageId: string,
	index: number,
	kind: "text" | "thinking",
	text: string,
): void {
	const id = blockId(messageId, index);
	if (!fitsId(id) || state.seenBlocks.has(id)) return;
	state.seenBlocks.add(id);
	state.startRun(out);
	out.push({ event: { type: "block_started", blockId: id, messageId, kind } });
	out.push({
		event: {
			type: "block_finished",
			blockId: id,
			text: clip(text, MAX_TEXT_CHARS),
		},
	});
}

function toolUse(state: TranslatorState, out: MappedEvent[], messageId: string, block: Record<string, unknown>): void {
	const id = typeof block.id === "string" ? toolCallId(block.id) : undefined;
	if (id === undefined || state.seenTools.has(id)) return;
	const name = nameOr(typeof block.name === "string" ? block.name : undefined, "tool");
	state.seenTools.add(id);
	state.startRun(out);
	state.tools.set(id, { name, input: block.input });
	const title = toolTitle(name, block.input);
	out.push({
		event: {
			type: "tool_started",
			toolCallId: id,
			name,
			...(title !== undefined && { title }),
			input: boundedJson(block.input),
			messageId,
		},
	});
}
