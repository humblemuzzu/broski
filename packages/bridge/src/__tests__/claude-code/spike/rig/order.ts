import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type BlockOrder = { blockId: string; kind: string; assistantAt: number; stopAt: number };

/**
 * For every main-thread `assistant` frame, where it arrived relative to its block's `content_block_stop`.
 * A streamed assistant frame carries one block; the k-th frame of a `message.id` is block index k.
 */
export function blockOrder(messages: readonly SDKMessage[]): BlockOrder[] {
	const stops = new Map<string, number>();
	let currentMessage = "";
	messages.forEach((message, at) => {
		if (message.type !== "stream_event") return;
		const event = message.event;
		if (event.type === "message_start") currentMessage = event.message.id;
		if (event.type === "content_block_stop") stops.set(`${currentMessage}:${event.index}`, at);
	});
	const seen = new Map<string, number>();
	const out: BlockOrder[] = [];
	messages.forEach((message, at) => {
		if (message.type !== "assistant" || message.parent_tool_use_id !== null) return;
		const id = message.message.id;
		const index = seen.get(id) ?? 0;
		seen.set(id, index + 1);
		const blockId = `${id}:${index}`;
		out.push({
			blockId,
			kind: message.message.content[0]?.type ?? "?",
			assistantAt: at,
			stopAt: stops.get(blockId) ?? -1,
		});
	});
	return out;
}

/** Position of the first frame matching `match`, or -1. */
export function indexOf(messages: readonly SDKMessage[], match: (message: SDKMessage) => boolean, from = 0): number {
	for (let at = from; at < messages.length; at++) if (match(messages[at] as SDKMessage)) return at;
	return -1;
}
