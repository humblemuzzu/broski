/**
 * The sub-runs a tool result carries. A subagent tool of the user's extensions (a Task, oracle or finder tool, such as
 * pi-coding-agent's `examples/extensions/subagent`) runs another agent of its own and returns its conversation in the
 * result's `details`: a `messages` list of Pi messages, one per sub-run, anywhere in a small tree of objects
 * (`details.messages`, `details.results[i].messages`). Pi gives the shape no name, so a sub-run is found by what it
 * holds: a list with at least one recognised message. What the extension adds beside it is not read.
 */

import { type JsonValue, MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { clipStart } from "../bounds";
import { boundedJson } from "../json";
import { phoneText } from "../phone-text";

export type SubBlock =
	| { readonly kind: "text" | "thinking"; readonly text: string }
	| { readonly kind: "call"; readonly id: string; readonly name: string; readonly input: JsonValue };

export type SubMessage =
	| { readonly role: "user"; readonly text: string }
	| { readonly role: "assistant"; readonly blocks: readonly SubBlock[]; readonly failure?: string }
	| { readonly role: "toolResult"; readonly toolCallId: string; readonly text: string; readonly isError: boolean };

export interface SubRun {
	readonly messages: readonly SubMessage[];
}

const MAX_DEPTH = 4;
const MAX_RUNS = 32;
const MAX_MESSAGES_PER_RUN = 2_000;
const MAX_BLOCKS_PER_MESSAGE = 200;
const MAX_KEYS = 64;

type Fields = { readonly [key: string]: unknown };

function isFields(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function subRunsOf(details: unknown): SubRun[] {
	const runs: SubRun[] = [];
	collect(details, 0, runs);
	return runs;
}

function collect(value: unknown, depth: number, runs: SubRun[]): void {
	if (depth > MAX_DEPTH || runs.length >= MAX_RUNS) return;
	if (Array.isArray(value)) {
		for (const item of value.slice(0, MAX_RUNS)) collect(item, depth + 1, runs);
		return;
	}
	if (!isFields(value)) return;
	if (Array.isArray(value.messages)) {
		const run = runOf(value.messages);
		if (run !== undefined) {
			runs.push(run);
			return;
		}
	}
	for (const child of Object.values(value).slice(0, MAX_KEYS)) collect(child, depth + 1, runs);
}

function runOf(list: readonly unknown[]): SubRun | undefined {
	const messages: SubMessage[] = [];
	for (const item of list.slice(0, MAX_MESSAGES_PER_RUN)) {
		const message = messageOf(item);
		if (message !== undefined) messages.push(message);
	}
	return messages.length === 0 ? undefined : { messages };
}

function messageOf(value: unknown): SubMessage | undefined {
	if (!isFields(value)) return undefined;
	switch (value.role) {
		case "user":
			return { role: "user", text: textOf(value.content) };
		case "assistant":
			return assistantOf(value);
		case "toolResult":
			if (typeof value.toolCallId !== "string") return undefined;
			return {
				role: "toolResult",
				toolCallId: value.toolCallId,
				text: textOf(value.content),
				isError: value.isError === true,
			};
		default:
			return undefined;
	}
}

function assistantOf(message: Fields): SubMessage {
	const blocks: SubBlock[] = [];
	const content = Array.isArray(message.content) ? message.content.slice(0, MAX_BLOCKS_PER_MESSAGE) : [];
	for (const block of content) {
		const sub = blockOf(block);
		if (sub !== undefined) blocks.push(sub);
	}
	const aborted = message.stopReason === "aborted";
	const failed = aborted || message.stopReason === "error";
	const reason = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
	return {
		role: "assistant",
		blocks,
		...(failed && { failure: phoneText(reason ?? (aborted ? "Operation aborted" : "Error")) }),
	};
}

function blockOf(block: unknown): SubBlock | undefined {
	if (!isFields(block)) return undefined;
	if (block.type === "text" && typeof block.text === "string") {
		return { kind: "text", text: clipStart(block.text, MAX_TEXT_CHARS) };
	}
	if (block.type === "thinking" && typeof block.thinking === "string") {
		return { kind: "thinking", text: clipStart(block.thinking, MAX_TEXT_CHARS) };
	}
	if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
		return { kind: "call", id: block.id, name: block.name, input: boundedJson(block.arguments ?? {}) };
	}
	return undefined;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return phoneText(content);
	if (!Array.isArray(content)) return "";
	const texts: string[] = [];
	for (const block of content.slice(0, MAX_LIST_ITEMS)) {
		if (isFields(block) && block.type === "text" && typeof block.text === "string") texts.push(block.text);
	}
	return phoneText(texts.join("\n"));
}
