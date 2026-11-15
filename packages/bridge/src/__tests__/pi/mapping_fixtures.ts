/**
 * Builders for the Pi values the mapping tests feed the mapping, and the contract checks they share. A message or an
 * event is written as `pi --mode rpc` writes it and read through the adapter's own frame schemas (`rpc/frames.ts`).
 */

import { itemsOfEntry } from "../../backends/pi/mapping/message-items";
import type { AssistantMessage, PiMessage, ToolCall } from "../../backends/pi/messages";
import { type PiEvent, type PiEventOf, parseFrame } from "../../backends/pi/rpc/frames";
import type { SessionEntry } from "../../backends/pi/store/entries";
import { isSessionEntry } from "../../backends/pi/store/migration";
import { AgentEvent, type SinkRecord, TranscriptItem } from "../../contract";

const ENTRY_TIME = "2026-01-02T03:04:05.000Z";
export const ENTRY_MS = Date.parse(ENTRY_TIME);
export const REQUEST_ID = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f";

/** An RPC event line as Pi writes it, read as the adapter reads it. */
export function piEvent<T extends PiEvent["type"]>(raw: { readonly type: T } & Record<string, unknown>): PiEventOf<T> {
	const frame = parseFrame(JSON.stringify(raw));
	if (frame.kind !== "event" || !isOfType(frame.event, raw.type)) {
		throw new Error(`not a ${raw.type} event: ${JSON.stringify(frame)}`);
	}
	return frame.event;
}

function isOfType<T extends PiEvent["type"]>(event: PiEvent, type: T): event is PiEventOf<T> {
	return event.type === type;
}

/** A message as Pi writes it, read as the adapter reads it. */
export function piMessage(raw: Record<string, unknown>): PiMessage {
	return piEvent({ type: "message_end", message: raw }).message;
}

/** An assistant message as Pi writes it, with the fields the adapter does not read. */
export function assistant(content: readonly object[], extra: Record<string, unknown> = {}): AssistantMessage {
	const message = piMessage({
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "scripted",
		model: "m1",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
		stopReason: "stop",
		timestamp: 1,
		...extra,
	});
	if (message.role !== "assistant") throw new Error("not an assistant message");
	return message;
}

export function toolCall(id: string, name: string, args: ToolCall["arguments"] = {}): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

/** The fields Pi gives every entry besides its type and id. */
export const BASE = { parentId: null, timestamp: ENTRY_TIME } as const;

/** A line of a session file as the store takes it: anything `isSessionEntry` accepts, written as Pi writes it. */
export function fileEntry(raw: object): SessionEntry {
	if (!isSessionEntry(raw)) throw new Error(`not a session entry: ${JSON.stringify(raw)}`);
	return raw;
}

export function messageEntry(id: string, message: PiMessage | Record<string, unknown>): SessionEntry {
	return fileEntry({ ...BASE, type: "message", id, message });
}

/** Freezes `value` all the way down, so a mapping that mutates Pi's object throws. */
export function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/** Items that all parse under the contract's schema; returns what the schema made of them. */
export function validItems(items: readonly TranscriptItem[]): TranscriptItem[] {
	return items.map((item) => TranscriptItem.parse(item));
}

export function validEvents(events: readonly AgentEvent[]): AgentEvent[] {
	return events.map((event) => AgentEvent.parse(event));
}

export function records(events: readonly AgentEvent[]): SinkRecord[] {
	return events.map((event) => ({ at: 1, event }));
}

/** What `itemsOfEntry` makes of a frozen entry, every item checked against the contract's schema. */
export function mapEntry(entry: SessionEntry, context = {}): TranscriptItem[] {
	return validItems(itemsOfEntry(deepFreeze(entry), deepFreeze(context)));
}
