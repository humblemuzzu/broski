/**
 * A session entry as a node of the tree the phone shows, with the text the terminal's `/tree` shows for it
 * (`getEntryDisplayText`, pi-coding-agent `src/modes/interactive/components/tree-selector.ts:774-861`). Entries that
 * never appear in the terminal's tree (`usage`) or that a newer Pi wrote have no node.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { TREE_PREVIEW_CHARS, type TreeNode, type TreeNodeKind } from "../../../contract";
import { entryItemId } from "../ids";
import { isCount } from "./usage";

export interface TreeLinks {
	readonly parentId: string | undefined;
	readonly label: string | undefined;
}

type Content = string | readonly { readonly type: string; readonly text?: string }[] | undefined;

/** The entry types the tree shows. */
export function isShownType(type: string): boolean {
	return (
		type === "message" ||
		type === "thinking_level_change" ||
		type === "model_change" ||
		type === "compaction" ||
		type === "branch_summary" ||
		type === "custom" ||
		type === "custom_message" ||
		type === "context_edit" ||
		type === "label" ||
		type === "session_info"
	);
}

export function treeNodeOf(entry: SessionEntry, links: TreeLinks): TreeNode | undefined {
	const described = describe(entry);
	if (described === undefined) return undefined;
	const at = Date.parse(entry.timestamp);
	const kept = described.raw ? described.text : described.text.replace(/\s+/g, " ").trim();
	const { text, cut } = clip(kept);
	return {
		id: entry.id,
		...(links.parentId !== undefined && { parentId: links.parentId }),
		itemId: entryItemId(entry.id, 0),
		kind: described.kind,
		...(isCount(at) && { at }),
		preview: text,
		previewCut: cut,
		...(links.label !== undefined && { label: links.label }),
	};
}

interface Described {
	readonly kind: TreeNodeKind;
	readonly text: string;
	/** Line breaks are the person's own and stay: a prompt put back into the composer reads as typed. */
	readonly raw: boolean;
}

function describe(entry: SessionEntry): Described | undefined {
	switch (entry.type) {
		case "message":
			return describeMessage(entry.message);
		case "custom_message":
			return { kind: "custom_message", text: `[${entry.customType}]: ${textOf(entry.content)}`, raw: false };
		case "compaction":
			return { kind: "compaction", text: `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`, raw: false };
		case "branch_summary":
			return { kind: "branch_summary", text: `[branch summary]: ${entry.summary}`, raw: false };
		case "model_change":
			return { kind: "model_change", text: `[model: ${entry.modelId}]`, raw: false };
		case "thinking_level_change":
			return { kind: "thinking_change", text: `[thinking: ${entry.thinkingLevel}]`, raw: false };
		case "session_info":
			return { kind: "session_info", text: `[title: ${entry.name ?? "empty"}]`, raw: false };
		case "label":
			return { kind: "label", text: `[label: ${entry.label ?? "(cleared)"}]`, raw: false };
		case "custom":
			return { kind: "custom", text: `[custom: ${entry.customType}]`, raw: false };
		case "context_edit":
			return {
				kind: "context_edit",
				text: `[context ${entry.replacement === null ? "omit" : "replace"}: ${entry.targetId}]`,
				raw: false,
			};
		default:
			return undefined;
	}
}

type EntryMessage = Extract<SessionEntry, { type: "message" }>["message"];

function describeMessage(message: EntryMessage): Described {
	switch (message.role) {
		case "user":
			return { kind: "user", text: textOf(message.content), raw: true };
		case "assistant":
			return describeAssistant(message);
		case "toolResult":
			return { kind: "tool_result", text: `[${message.toolName}]: ${textOf(message.content)}`, raw: false };
		case "bashExecution":
			return { kind: "bash", text: `$ ${message.command}`, raw: false };
		case "custom":
			return { kind: "custom_message", text: `[${message.customType}]: ${textOf(message.content)}`, raw: false };
		default:
			return { kind: "custom", text: `[${message.role}]`, raw: false };
	}
}

type Assistant = Extract<EntryMessage, { role: "assistant" }>;

/** Like the terminal, an assistant message that only calls tools is not a place to go back to, unless it failed. */
function describeAssistant(message: Assistant): Described {
	const texts: string[] = [];
	const tools: string[] = [];
	for (const block of message.content ?? []) {
		if (block.type === "text") texts.push(block.text);
		else if (block.type === "toolCall") tools.push(block.name);
	}
	const text = texts.join("\n").trim();
	if (text !== "") return { kind: "assistant", text, raw: false };
	const failed = message.stopReason !== undefined && message.stopReason !== "stop" && message.stopReason !== "toolUse";
	if (failed) {
		return { kind: "assistant", text: message.errorMessage ?? `(${message.stopReason})`, raw: false };
	}
	return { kind: "assistant_tools", text: tools.length === 0 ? "(no text)" : tools.join(", "), raw: false };
}

function textOf(content: Content): string {
	if (typeof content === "string") return content;
	const texts: string[] = [];
	for (const block of content ?? []) if (block.type === "text" && block.text !== undefined) texts.push(block.text);
	return texts.join("\n");
}

/** Cut on a code point, never inside a surrogate pair. */
function clip(text: string): { text: string; cut: boolean } {
	const points = Array.from(text);
	if (points.length <= TREE_PREVIEW_CHARS) return { text, cut: false };
	return { text: points.slice(0, TREE_PREVIEW_CHARS).join(""), cut: true };
}
