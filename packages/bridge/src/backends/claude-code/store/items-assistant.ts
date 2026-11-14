/** The transcript items of one assistant entry: its text, thinking and tool-call blocks (D26). */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS, type TranscriptItem } from "../../../contract";
import { clip, fitsId, nameOr } from "../bounds";
import { blockId, toolCallId } from "../ids";
import { boundedJson } from "../json";
import { toolTitle } from "../mapping/tool-titles";
import type { ItemContext } from "./items";
import { apiMessageId, blocksOf, entryTimestamp, stringField, toolCallOf } from "./message-parts";

const SPAWNING_TOOLS = new Set(["Agent", "Task"]);

/** The name the live stream shows: the CLI called the subagent tool `Task` before 2.1.63. */
function toolNameOf(name: string): string {
	return name === "Task" ? "Agent" : name;
}

export function assistantItems(message: SessionMessage, context: ItemContext): TranscriptItem[] {
	const apiId = apiMessageId(message);
	const messageId = apiId !== undefined && fitsId(apiId) ? apiId : message.uuid;
	const at = entryTimestamp(message);
	const items: TranscriptItem[] = [];
	blocksOf(message).forEach((block, offset) => {
		const index = context.blockBase + offset;
		const type = stringField(block, "type");
		const body =
			type === "thinking" ? stringField(block, "thinking") : type === "text" ? stringField(block, "text") : undefined;
		if (body !== undefined) {
			if (body.trim() === "") return;
			items.push({
				kind: "block",
				id: blockId(messageId, index),
				...(at !== undefined && { at }),
				messageId,
				block: type === "thinking" ? "thinking" : "text",
				text: clip(body, MAX_TEXT_CHARS),
			});
			return;
		}
		const call = callItem(block, messageId, at, context);
		if (call !== undefined) items.push(call);
	});
	return items;
}

function callItem(
	block: unknown,
	messageId: string,
	at: number | undefined,
	context: ItemContext,
): TranscriptItem | undefined {
	const call = toolCallOf(block);
	const id = call === undefined ? undefined : toolCallId(call.id);
	if (call === undefined || id === undefined) return undefined;
	const name = toolNameOf(call.name);
	const input = blockInput(block);
	const title = toolTitle(name, input);
	const child = SPAWNING_TOOLS.has(name) ? context.childOf(call.id) : undefined;
	return {
		kind: "tool_call",
		id,
		...(at !== undefined && { at }),
		toolCallId: id,
		messageId,
		name: nameOr(name, "tool"),
		...(title !== undefined && title !== "" && { title: clip(title, MAX_NAME_CHARS) }),
		input: boundedJson(input),
		...(child !== undefined && {
			childSession: { backend: "claude-code", sessionId: child },
		}),
	};
}

function blockInput(block: unknown): unknown {
	return typeof block === "object" && block !== null && "input" in block ? block.input : undefined;
}
