/** `retracted_message_uuids` and `supersedes` as `messages_retracted`. */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_LIST_ITEMS } from "../../../contract";
import { fitsId } from "../bounds";
import type { MappedEvent } from "../ports/mapping";
import { fanOut } from "./routing";
import type { MapperState } from "./state";

/** The uuids a frame withdraws: the fallback notice lists the refused leg's, the frame that replaces it names them too. */
function withdrawnUuids(frame: SDKMessage): readonly string[] {
	if (frame.type === "assistant") return frame.supersedes ?? [];
	if (frame.type === "system" && frame.subtype === "model_refusal_fallback") return frame.retracted_message_uuids ?? [];
	return [];
}

/** What a retraction takes out of the mapper's own bookkeeping: its open blocks and tool calls disappear with it. */
function forget(state: MapperState, messageIds: ReadonlySet<string>): void {
	for (const [id, open] of [...state.openBlocks]) if (messageIds.has(open.messageId)) state.openBlocks.delete(id);
	for (const [id, open] of [...state.openTools]) {
		if (open.messageId === undefined || !messageIds.has(open.messageId)) continue;
		state.openTools.delete(id);
		state.denied.delete(id);
	}
}

/** The `message.id`s the frame withdraws, per stream they were shown in. */
function withdrawnByStream(state: MapperState, frame: SDKMessage): Map<string, Set<string>> {
	const own = frame.type === "assistant" ? frame.message.id : undefined;
	const byStream = new Map<string, Set<string>>();
	for (const uuid of withdrawnUuids(frame)) {
		const known = state.frameMessages.get(uuid);
		state.frameMessages.delete(uuid);
		if (known === undefined || known.messageId === own || !fitsId(known.messageId)) continue;
		if (state.retracted.has(known.messageId)) continue;
		for (const stream of known.streams) {
			byStream.set(stream, (byStream.get(stream) ?? new Set()).add(known.messageId));
		}
	}
	return byStream;
}

/**
 * The messages the frame withdraws, by the `message.id` of the assistant frames it names. A uuid the mapper never saw
 * is a no-op (eviction is idempotent, `SDKAssistantMessage.supersedes`), and so is a user frame it names: a refused
 * attempt's tool results go with the assistant message that called them. A message already withdrawn is not withdrawn
 * twice, and the message the frame itself delivers is never withdrawn by it.
 */
export function retractionEvents(state: MapperState, frame: SDKMessage): MappedEvent[] {
	const byStream = withdrawnByStream(state, frame);
	if (byStream.size === 0) return [];
	const messageIds = new Set([...byStream.values()].flatMap((ids) => [...ids]));
	for (const id of messageIds) state.retracted.add(id);
	forget(state, messageIds);
	return [...byStream].flatMap(([stream, ids]) =>
		fanOut([stream], () => ({
			type: "messages_retracted",
			messageIds: [...ids].slice(0, MAX_LIST_ITEMS),
		})),
	);
}
