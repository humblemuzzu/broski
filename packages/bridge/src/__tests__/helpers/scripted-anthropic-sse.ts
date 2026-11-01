/**
 * Turns one scripted model answer into the Anthropic Messages wire format: the SSE events of a streamed
 * answer, or the single JSON message of a non-streamed one. The block order is thinking, text, tool calls.
 */

export type ScriptedToolCall = { name: string; args: Record<string, unknown>; id?: string };

export type ScriptedStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal";

/** One model response. */
export type ScriptedTurn = {
	thinking?: string[];
	text?: string[];
	toolCalls?: ScriptedToolCall[];
	/** Defaults to `tool_use` when the turn has tool calls, else `end_turn`. */
	stopReason?: ScriptedStopReason;
	/** Answer with this HTTP status and an Anthropic error body instead of a message (529 = overloaded). */
	status?: number;
	/** Pause between SSE events, for scenarios that need a run to be caught mid-stream. */
	delayMs?: number;
	/** Appends `model=<the request's model>` to the text, so a test can see which model the CLI asked for. */
	echoModel?: boolean;
};

export type WireBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; signature: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type SseEvent = { event: string; data: Record<string, unknown> };

export const INPUT_TOKENS = 100;
export const DEFAULT_CHUNK_GAP_MS = 4;
const ARGUMENT_FRAGMENT_CHARS = 7;

function fragments(json: string): string[] {
	const parts: string[] = [];
	for (let at = 0; at < json.length; at += ARGUMENT_FRAGMENT_CHARS)
		parts.push(json.slice(at, at + ARGUMENT_FRAGMENT_CHARS));
	return parts;
}

function stopReasonOf(turn: ScriptedTurn): ScriptedStopReason {
	return turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");
}

function textPieces(turn: ScriptedTurn, model: string): string[] {
	const pieces = [...(turn.text ?? [])];
	if (turn.echoModel) pieces.push(`model=${model}`);
	return pieces;
}

function signatureOf(thinking: string): string {
	return `sig_${Bun.hash(thinking).toString(16)}`;
}

function toolId(call: ScriptedToolCall, messageId: string, index: number): string {
	return call.id ?? `toolu_${messageId.replace(/^msg_/, "")}_${index}`;
}

/** The complete blocks a turn produces, as a non-streamed message carries them. */
export function turnBlocks(turn: ScriptedTurn, model: string, messageId: string): WireBlock[] {
	const blocks: WireBlock[] = [];
	const thinking = (turn.thinking ?? []).join("");
	if (turn.thinking?.length) blocks.push({ type: "thinking", thinking, signature: signatureOf(thinking) });
	const text = textPieces(turn, model);
	if (text.length > 0) blocks.push({ type: "text", text: text.join("") });
	(turn.toolCalls ?? []).forEach((call, index) => {
		blocks.push({ type: "tool_use", id: toolId(call, messageId, index), name: call.name, input: call.args });
	});
	return blocks;
}

function usage(outputTokens: number) {
	return {
		input_tokens: INPUT_TOKENS,
		output_tokens: outputTokens,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
	};
}

/** The non-streamed answer: one JSON message. */
export function turnMessage(turn: ScriptedTurn, model: string, messageId: string): Record<string, unknown> {
	return {
		id: messageId,
		type: "message",
		role: "assistant",
		model,
		content: turnBlocks(turn, model, messageId),
		stop_reason: stopReasonOf(turn),
		stop_sequence: null,
		usage: usage(20),
	};
}

function blockEvents(index: number, start: Record<string, unknown>, deltas: Record<string, unknown>[]): SseEvent[] {
	return [
		{ event: "content_block_start", data: { type: "content_block_start", index, content_block: start } },
		...deltas.map((delta) => ({ event: "content_block_delta", data: { type: "content_block_delta", index, delta } })),
		{ event: "content_block_stop", data: { type: "content_block_stop", index } },
	];
}

function streamedBlockEvents(turn: ScriptedTurn, model: string, messageId: string): SseEvent[] {
	const events: SseEvent[] = [];
	let index = 0;
	if (turn.thinking?.length) {
		const deltas: Record<string, unknown>[] = turn.thinking.map((thinking) => ({ type: "thinking_delta", thinking }));
		deltas.push({ type: "signature_delta", signature: signatureOf(turn.thinking.join("")) });
		events.push(...blockEvents(index++, { type: "thinking", thinking: "", signature: "" }, deltas));
	}
	const text = textPieces(turn, model);
	if (text.length > 0) {
		const deltas = text.map((piece) => ({ type: "text_delta", text: piece }));
		events.push(...blockEvents(index++, { type: "text", text: "" }, deltas));
	}
	(turn.toolCalls ?? []).forEach((call, callIndex) => {
		const start = { type: "tool_use", id: toolId(call, messageId, callIndex), name: call.name, input: {} };
		const deltas = ["", ...fragments(JSON.stringify(call.args))].map((partial_json) => ({
			type: "input_json_delta",
			partial_json,
		}));
		events.push(...blockEvents(index++, start, deltas));
	});
	return events;
}

/** The streamed answer: `message_start`, each block's start/deltas/stop, `message_delta`, `message_stop`. */
export function turnEvents(turn: ScriptedTurn, model: string, messageId: string): SseEvent[] {
	const message = { ...turnMessage(turn, model, messageId), content: [], stop_reason: null, usage: usage(1) };
	return [
		{ event: "message_start", data: { type: "message_start", message } },
		...streamedBlockEvents(turn, model, messageId),
		{
			event: "message_delta",
			data: {
				type: "message_delta",
				delta: { stop_reason: stopReasonOf(turn), stop_sequence: null },
				usage: { output_tokens: 20 },
			},
		},
		{ event: "message_stop", data: { type: "message_stop" } },
	];
}

export function encodeSse(event: SseEvent): string {
	return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** The Anthropic error body for an HTTP error status. */
export function errorBody(status: number): Record<string, unknown> {
	const type =
		status === 529
			? "overloaded_error"
			: status === 429
				? "rate_limit_error"
				: status >= 500
					? "api_error"
					: "invalid_request_error";
	return { type: "error", error: { type, message: `scripted ${status}` } };
}

/** Streams `events` with a pause before each, so partial-message deltas really arrive one by one. */
export function sseStream(events: SseEvent[], gapMs: number): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let next = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (next >= events.length) {
				controller.close();
				return;
			}
			await Bun.sleep(gapMs);
			controller.enqueue(encoder.encode(encodeSse(events[next] as SseEvent)));
			next += 1;
		},
	});
}
