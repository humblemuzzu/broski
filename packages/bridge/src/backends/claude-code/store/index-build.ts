/** Lane A · the skeleton of one chain read: what a page needs to find an entry, a block's index and a tool's name. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FileStamp } from "./locator";
import { apiMessageId, blocksOf, resultOf, toolCallOf } from "./message-parts";
import type { RawFacts } from "./raw-scan";
import type { EntryType, IndexEntry } from "./transcript-index";

export function buildIndex(messages: readonly SessionMessage[], stamp: FileStamp, raw: RawFacts): IndexEntry {
	const uuids: string[] = [];
	const types: EntryType[] = [];
	const positions = new Map<string, number>();
	const messageIds: (string | undefined)[] = [];
	const blockBase: number[] = [];
	const blockCounts: number[] = [];
	const toolCalls = new Map<string, number>();
	const toolResults = new Map<string, number>();
	const toolNames = new Map<string, string>();
	const blocksSeen = new Map<string, number>();
	messages.forEach((message, position) => {
		uuids.push(message.uuid);
		types.push(message.type);
		positions.set(message.uuid, position);
		const content = blocksOf(message);
		const messageId = message.type === "assistant" ? apiMessageId(message) : undefined;
		const before = messageId === undefined ? 0 : (blocksSeen.get(messageId) ?? 0);
		if (messageId !== undefined) blocksSeen.set(messageId, before + content.length);
		messageIds.push(messageId);
		blockBase.push(before);
		blockCounts.push(content.length);
		for (const block of content) {
			const call = toolCallOf(block);
			const answered = resultOf(block);
			if (call !== undefined) {
				toolCalls.set(call.id, position);
				toolNames.set(call.id, call.name);
			}
			if (answered !== undefined) toolResults.set(answered, position);
		}
	});
	return {
		size: stamp.size,
		mtimeMs: stamp.mtimeMs,
		count: messages.length,
		uuids,
		types,
		positions,
		messageIds,
		blockBase,
		blockCounts,
		toolCalls,
		toolResults,
		toolNames,
		raw,
	};
}
