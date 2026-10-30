/** Builders for the Pi values the mapping tests feed the mapping, and the contract checks they share. */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { itemsOfEntry } from "../../backends/pi/mapping/message-items";
import { AgentEvent, type SinkRecord, TranscriptItem } from "../../contract";

const ENTRY_TIME = "2026-01-02T03:04:05.000Z";
export const ENTRY_MS = Date.parse(ENTRY_TIME);
export const REQUEST_ID = "6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f";

function usage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function assistant(
	content: AssistantMessage["content"],
	extra: Partial<AssistantMessage> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "faux",
		provider: "faux",
		model: "m1",
		usage: usage(),
		stopReason: "stop",
		timestamp: 1,
		...extra,
	};
}

export function toolCall(id: string, name: string, args: ToolCall["arguments"] = {}): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

/** The fields Pi gives every entry besides its type and id. */
export const BASE = { parentId: null, timestamp: ENTRY_TIME } as const;

export function messageEntry(id: string, message: AgentMessage): SessionMessageEntry {
	return { ...BASE, type: "message", id, message };
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
