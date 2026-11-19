/**
 * The transcript items of one user entry (D26, D10): a prompt, a compaction summary, tool results, or what the CLI
 * wrote there itself: a background task's end, a command's output, an interrupt (`harnessText`).
 */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	type Activity,
	type AttachmentRef,
	ClientRequestId,
	type ImageRef,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type TranscriptItem,
} from "../../../contract";
import { clip } from "../bounds";
import { toolCallId, toolResultItemId } from "../ids";
import { commandOutputActivity, savedTaskActivity, shellOutputActivity } from "../mapping/activities";
import { type HarnessText, harnessText } from "../mapping/harness-text";
import { extractUserImagePaths, stripImagePlaceholders } from "../mapping/image-paths";
import { imageRefsOf } from "../mapping/images";
import { toolResultOf } from "../mapping/tool-results";
import type { PromptRecord } from "../ports/store";
import type { ItemContext } from "./items";
import {
	contentList,
	contentText,
	entryTimestamp,
	isCompactSummary,
	rawContent,
	resultOf,
	stringField,
} from "./message-parts";

/** The journal keeps the name of each image the phone sent; the CLI keeps none (D10). */
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
	const said = harnessText(textOf(message));
	const base = { id: message.uuid, ...(at !== undefined && { at }) };
	if (said.kind === "interrupt") return [...items, { kind: "run_boundary", ...base, outcome: { kind: "aborted" } }];
	if (said.kind === "prompt" || said.kind === "context") {
		const prompt = promptItem(message, context, at, said.kind === "prompt" ? said.text : "");
		return prompt === undefined ? items : [...items, prompt];
	}
	const activity = reported(said, context);
	return activity === undefined ? items : [...items, { kind: "activity", ...base, activity }];
}

function reported(said: HarnessText, context: ItemContext): Activity | undefined {
	switch (said.kind) {
		case "task":
			return savedTaskActivity(said.notification, context.sessionId);
		case "command_output":
			return commandOutputActivity(said.text, said.failed);
		case "shell_output":
			return shellOutputActivity(said.stdout, said.stderr);
		default:
			return undefined;
	}
}

function promptItem(
	message: SessionMessage,
	context: ItemContext,
	at: number | undefined,
	text: string,
): TranscriptItem | undefined {
	const record = context.prompt(message.uuid);
	const refs = nameImages(imageRefsOf(rawContent(message), message.uuid), record);
	const displayText = refs.length > 0 ? stripImagePlaceholders(text) : text;
	const attachments: AttachmentRef[] =
		refs.length > 0 ? refs : extractUserImagePaths(displayText, context.cwd).slice(0, MAX_LIST_ITEMS);
	if (displayText.trim() === "" && attachments.length === 0) return undefined;
	return {
		kind: "user_message",
		id: message.uuid,
		...(at !== undefined && { at }),
		text: clip(displayText, MAX_TEXT_CHARS),
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
