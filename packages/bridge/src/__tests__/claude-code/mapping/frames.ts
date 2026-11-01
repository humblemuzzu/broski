/**
 * Frames for the unit tests, derived from recorded ones: each builder spreads a real frame of the CLI and changes only
 * what the test is about, so every frame stays a valid `SDKMessage` without a cast.
 */

import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKPartialAssistantMessage,
	SDKResultError,
	SDKResultSuccess,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { readFrameFixture } from "../helpers/frame-fixtures";

type Content = SDKAssistantMessage["message"]["content"];
export type StreamEvent = SDKPartialAssistantMessage["event"];
type Uuid = SDKAssistantMessage["uuid"];

function first<T extends SDKMessage>(scenario: string, pick: (frame: SDKMessage) => frame is T): T {
	const found = readFrameFixture(scenario).find(pick);
	if (!found) throw new Error(`fixture ${scenario} has no such frame`);
	return found;
}

const isAssistant = (frame: SDKMessage): frame is SDKAssistantMessage => frame.type === "assistant";
const isUser = (frame: SDKMessage): frame is SDKUserMessage => frame.type === "user" && !("isReplay" in frame);
const isStream = (frame: SDKMessage): frame is SDKPartialAssistantMessage => frame.type === "stream_event";
const isSuccess = (frame: SDKMessage): frame is SDKResultSuccess =>
	frame.type === "result" && frame.subtype === "success";
const isFailure = (frame: SDKMessage): frame is SDKResultError =>
	frame.type === "result" && frame.subtype !== "success";

const ASSISTANT = first("text", isAssistant);
const TOOL_RESULT = first("tool-read", isUser);
const STREAM = first("text", isStream);
const SUCCESS = first("text", isSuccess);
const FAILURE = first("interrupt-mid-text", isFailure);

export const SESSION = ASSISTANT.session_id;

let counter = 0;
/** A fresh uuid for each frame a test builds. */
export function uuid(): Uuid {
	counter += 1;
	return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

export function assistant(
	messageId: string,
	content: Content,
	extra: Partial<SDKAssistantMessage> = {},
): SDKAssistantMessage {
	return { ...ASSISTANT, uuid: uuid(), message: { ...ASSISTANT.message, id: messageId, content }, ...extra };
}

export function text(value: string): Content[number] {
	return { type: "text", text: value, citations: null };
}

export function thinking(value: string): Content[number] {
	return { type: "thinking", thinking: value, signature: "" };
}

export function toolUse(id: string, name: string, input: unknown): Content[number] {
	return { type: "tool_use", id, name, input };
}

export function stream(
	event: StreamEvent,
	extra: Partial<SDKPartialAssistantMessage> = {},
): SDKPartialAssistantMessage {
	return { ...STREAM, uuid: uuid(), event, ...extra };
}

export function messageStart(messageId: string): SDKPartialAssistantMessage {
	return stream({ type: "message_start", message: { ...ASSISTANT.message, id: messageId, content: [] } });
}

export function blockStart(
	index: number,
	block: Extract<StreamEvent, { type: "content_block_start" }>["content_block"],
) {
	return stream({ type: "content_block_start", index, content_block: block });
}

export function textDelta(index: number, value: string) {
	return stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: value } });
}

export function thinkingDelta(index: number, value: string) {
	return stream({
		type: "content_block_delta",
		index,
		delta: { type: "thinking_delta", thinking: value, estimated_tokens: null },
	});
}

export function inputJsonDelta(index: number, partial: string) {
	return stream({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: partial } });
}

export function blockStop(index: number) {
	return stream({ type: "content_block_stop", index });
}

export function messageStop() {
	return stream({ type: "message_stop" });
}

export interface ResultOptions {
	readonly isError?: boolean;
	readonly structured?: unknown;
	readonly extra?: Partial<SDKUserMessage>;
}

type ResultContent = NonNullable<
	Extract<Exclude<SDKUserMessage["message"]["content"], string>[number], { type: "tool_result" }>["content"]
>;

export function toolResult(toolUseId: string, content: ResultContent, options: ResultOptions = {}): SDKUserMessage {
	const block = {
		type: "tool_result" as const,
		tool_use_id: toolUseId,
		content,
		...(options.isError && { is_error: true }),
	};
	const { tool_use_result: _dropped, ...base } = TOOL_RESULT;
	const frame: SDKUserMessage = {
		...base,
		uuid: uuid(),
		message: { role: "user", content: [block] },
		...options.extra,
	};
	return options.structured === undefined ? frame : { ...frame, tool_use_result: options.structured };
}

export function userText(value: string, extra: Partial<SDKUserMessage> = {}): SDKUserMessage {
	const { tool_use_result: _dropped, ...base } = TOOL_RESULT;
	return { ...base, uuid: uuid(), message: { role: "user", content: [{ type: "text", text: value }] }, ...extra };
}

export function success(extra: Partial<SDKResultSuccess> = {}): SDKResultSuccess {
	return { ...SUCCESS, ...extra };
}

export function failure(extra: Partial<SDKResultError> = {}): SDKResultError {
	return { ...FAILURE, ...extra };
}

/** The `session_id` and `uuid` every system frame has. */
export function ids(): { uuid: Uuid; session_id: string } {
	return { uuid: uuid(), session_id: SESSION };
}
