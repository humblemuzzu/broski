/** Lane A · reading the parts of a `SessionMessage` the SDK types as `unknown` or leaves out, without a cast. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../json";

/** `message.id` of an assistant entry (the API message its blocks belong to). */
export function apiMessageId(message: SessionMessage): string | undefined {
	return isRecord(message.message) && typeof message.message.id === "string" ? message.message.id : undefined;
}

/** `message.content` as a list; a string content is not a list of blocks. */
export function contentList(message: SessionMessage): readonly unknown[] | undefined {
	return isRecord(message.message) && Array.isArray(message.message.content) ? message.message.content : undefined;
}

/** `message.content` when it is a plain string (a typed prompt). */
export function contentText(message: SessionMessage): string | undefined {
	return isRecord(message.message) && typeof message.message.content === "string" ? message.message.content : undefined;
}

/** The content blocks of an entry; a plain string is one text block. */
export function blocksOf(message: SessionMessage): readonly unknown[] {
	const list = contentList(message);
	if (list !== undefined) return list;
	const text = contentText(message);
	return text === undefined ? [] : [{ type: "text", text }];
}

/** `message.content`, whichever shape: what `imageRefsOf`/`imageAt` read. */
export function rawContent(message: SessionMessage): unknown {
	return isRecord(message.message) ? message.message.content : undefined;
}

export function stringField(block: unknown, key: string): string | undefined {
	return isRecord(block) && typeof block[key] === "string" ? block[key] : undefined;
}

/** The runtime fields `getSessionMessages` adds beyond the declared type (`sdk.mjs` `$R`). */
export function entryTimestamp(message: SessionMessage): number | undefined {
	if (!("timestamp" in message) || typeof message.timestamp !== "string") return undefined;
	const at = Date.parse(message.timestamp);
	return Number.isFinite(at) && at >= 0 ? at : undefined;
}

export function isCompactSummary(message: SessionMessage): boolean {
	return "isCompactSummary" in message && message.isCompactSummary === true;
}

const CALL_BLOCKS = new Set(["tool_use", "server_tool_use", "mcp_tool_use"]);

/** The `tool_use` id and tool name of a content block that calls a tool. */
export function toolCallOf(block: unknown): { id: string; name: string } | undefined {
	if (!isRecord(block) || typeof block.type !== "string" || !CALL_BLOCKS.has(block.type)) return undefined;
	return typeof block.id === "string" && typeof block.name === "string"
		? { id: block.id, name: block.name }
		: undefined;
}

/** The `tool_use_id` a `tool_result` block answers. */
export function resultOf(block: unknown): string | undefined {
	return isRecord(block) && block.type === "tool_result" ? stringField(block, "tool_use_id") : undefined;
}
