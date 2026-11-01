/** Lane A · the transcript items of one user entry: a prompt, a compaction summary, or tool results (D18, D37). */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClientRequestId, type ImageRef, MAX_NAME_CHARS, MAX_TEXT_CHARS, type TranscriptItem } from "../../../contract";
import { clip } from "../bounds";
import { toolCallId, toolResultItemId } from "../ids";
import { imageRefsOf } from "../mapping/images";
import { toolResultOf } from "../mapping/tool-results";
import type { PromptRecord } from "../ports/store";
import type { ItemContext } from "./items";
import { localCommandText } from "./local-commands";
import {
	contentList,
	contentText,
	entryTimestamp,
	isCompactSummary,
	rawContent,
	resultOf,
	stringField,
} from "./message-parts";

/** The journal keeps the name of each image the phone sent; the CLI keeps none (D37). */
export function nameImages(refs: readonly ImageRef[], record: PromptRecord | undefined): ImageRef[] {
	return refs.map((ref, position) => {
		const name = record?.imageNames[position];
		return name === undefined || name === "" ? ref : { ...ref, name: clip(name, MAX_NAME_CHARS) };
	});
}

function textOf(message: SessionMessage): string {
	const text = contentText(message);
	if (text !== undefined) return text;
	const parts = (contentList(message) ?? []).flatMap((block) =>
		stringField(block, "type") === "text" ? [stringField(block, "text") ?? ""] : [],
	);
	return parts.join("\n");
}

export function userItems(message: SessionMessage, context: ItemContext): TranscriptItem[] {
	const at = entryTimestamp(message);
	if (isCompactSummary(message)) {
		return [
			{
				kind: "compaction",
				id: message.uuid,
				...(at !== undefined && { at }),
				summary: clip(textOf(message), MAX_TEXT_CHARS),
				...context.previousSystem?.boundary,
			},
		];
	}
	const items: TranscriptItem[] = [];
	(contentList(message) ?? []).forEach((block, blockIndex) => {
		const result = resultItem(block, { message, blockIndex, at, context });
		if (result !== undefined) items.push(result);
	});
	const local = localCommandText(textOf(message));
	if (local?.kind === "output") {
		if (local.text !== "")
			items.push({
				kind: "notice",
				id: message.uuid,
				...(at !== undefined && { at }),
				level: local.level,
				text: clip(local.text, MAX_TEXT_CHARS),
			});
		return items;
	}
	const prompt = promptItem(message, context, at, local?.text ?? textOf(message));
	return prompt === undefined ? items : [...items, prompt];
}

function promptItem(
	message: SessionMessage,
	context: ItemContext,
	at: number | undefined,
	text: string,
): TranscriptItem | undefined {
	const record = context.prompt(message.uuid);
	const attachments = nameImages(imageRefsOf(rawContent(message), message.uuid), record);
	if (text.trim() === "" && attachments.length === 0) return undefined;
	return {
		kind: "user_message",
		id: message.uuid,
		...(at !== undefined && { at }),
		text: clip(text, MAX_TEXT_CHARS),
		attachments,
		...(record !== undefined && ClientRequestId.safeParse(message.uuid).success && { clientRequestId: message.uuid }),
	};
}

interface ResultSite {
	readonly message: SessionMessage;
	readonly blockIndex: number;
	readonly at: number | undefined;
	readonly context: ItemContext;
}

function resultItem(block: unknown, site: ResultSite): TranscriptItem | undefined {
	const answered = resultOf(block);
	const id = answered === undefined ? undefined : toolCallId(answered);
	if (answered === undefined || id === undefined) return undefined;
	const place = { entryUuid: site.message.uuid, blockIndex: site.blockIndex };
	const { outcome, result } = toolResultOf(block, site.context.toolUseResult, place, site.context.toolName(answered));
	return {
		kind: "tool_result",
		id: toolResultItemId(id),
		...(site.at !== undefined && { at: site.at }),
		toolCallId: id,
		outcome,
		result,
	};
}
