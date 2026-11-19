/** Session entries as transcript items, and a persisted user message as `user_message`. */

import {
	type AttachmentRef,
	type ImageRef,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type SessionRef,
	type ToolCallId,
	type TranscriptItem,
	type UserMessageEvent,
} from "../../../contract";
import { clipStart } from "../bounds";
import type { PromptRecord, RecordedToolOutcome } from "../broski-entries";
import { entryAttachmentId, entryItemId, mintMessageId, storedToolCallId } from "../ids";
import { boundedJson } from "../json";
import type { AssistantMessage, ImageContent, ToolCall, ToolResultMessage, UserContent } from "../messages";
import { hasWireId, modelWireId } from "../models/model-ids";
import { phoneText } from "../phone-text";
import type { MessageEntry, ModelChangeEntry, SessionEntry, ThinkingLevelChangeEntry } from "../store/entries";
import { bashItems } from "./bash-items";
import { customActivity } from "./custom-activity";
import { extractUserImagePaths } from "./image-paths";
import { typedText } from "./prompt-title";
import { fileChangesOf, toolNameOf, toolOutcome, toolResultOf } from "./tool-items";
import { isCount } from "./usage";

export interface EntryContext {
	/** For an assistant message: the child session of each call (by the provider's call id) that ran a sub-run. */
	readonly childSessions?: ReadonlyMap<string, SessionRef>;
	/** The `broski.prompt` record of a user message entry. */
	readonly prompt?: PromptRecord;
	/**
	 * For a `toolResult` entry, the id of the call it answers, which only the branch can tell: see
	 * `storedToolCallId`.
	 */
	readonly toolCallId?: ToolCallId;
	/**
	 * For a `toolResult` entry, the arguments of the call it answers (the branch's assistant entry holds
	 * them). A result stores none, and `write`'s file change needs its `path`; `edit`'s is read from its patch.
	 */
	readonly toolInput?: Readonly<Record<string, unknown>>;
	/** For a `toolResult` entry, the outcome its `broski.tool_outcome` record holds. */
	readonly toolOutcome?: RecordedToolOutcome;
	/** The session's working directory, for resolving relative image paths in user messages. */
	readonly cwd?: string;
}

/** A file can hold a message whose content is missing, which Pi reads as empty. */
type Content = UserContent | null | undefined;
/**
 * An entry's items, ids `entryItemId(entry.id, index)`. Left out, with the reason: `system` messages carry
 * the prompt and tool declarations, never a turn; `label`, `session_info`, `usage`, `context_edit` and
 * `custom` entries are bookkeeping (the title and the adapter's own `broski.*` records among them); a
 * `branchSummary` or `compactionSummary` message is never stored as a message entry, only as the entry types handled
 * here (pi-coding-agent 1.5.2 `docs/session-format.md:237-248`); an entry type this does not know is a newer Pi's,
 * never an error.
 */
export function itemsOfEntry(entry: SessionEntry, context: EntryContext): TranscriptItem[] {
	const at = timestampOf(entry.timestamp);
	const stamp = at === undefined ? {} : { at };
	switch (entry.type) {
		case "message":
			return messageItems(entry, context, stamp);
		case "custom_message":
			return activityOf(entry.id, stamp, entry);
		case "branch_summary":
			return noticeOf(
				entry.id,
				stamp,
				typeof entry.summary === "string" && entry.summary !== "" ? `Branch summary:\n${entry.summary}` : undefined,
			);
		case "compaction":
			return [
				{
					kind: "compaction",
					id: entryItemId(entry.id, 0),
					...stamp,
					...(typeof entry.summary === "string" && { summary: clipStart(entry.summary, MAX_TEXT_CHARS) }),
					...(isCount(entry.tokensBefore) && { tokensBefore: entry.tokensBefore }),
				},
			];
		case "model_change":
			return modelChangeItems(entry, stamp);
		case "thinking_level_change":
			return thinkingChangeItems(entry, stamp);
		default:
			return [];
	}
}

/**
 * The live `user_message` of a prompt: its id is the one the stored entry's item will have, and its images are named
 * by that entry. Without the entry (Pi did not say where it stored the message) the id is minted and the images
 * cannot be named.
 */
export function userMessageEvent(
	content: Content,
	entryId: string | undefined,
	prompt: PromptRecord | undefined,
	cwd?: string,
): UserMessageEvent {
	const { text, attachments } = userContent(content, entryId, prompt, cwd);
	return {
		type: "user_message",
		messageId: entryId === undefined ? mintMessageId() : entryItemId(entryId, 0),
		text,
		attachments,
		...(prompt !== undefined && { clientRequestId: prompt.clientRequestId }),
	};
}

type Stamp = { at?: number };

function messageItems(entry: MessageEntry, context: EntryContext, stamp: Stamp): TranscriptItem[] {
	const message = entry.message;
	switch (message.role) {
		case "user": {
			const { text, attachments } = userContent(message.content, entry.id, context.prompt, context.cwd);
			return [
				{
					kind: "user_message",
					id: entryItemId(entry.id, 0),
					...stamp,
					text,
					attachments,
					...(context.prompt !== undefined && { clientRequestId: context.prompt.clientRequestId }),
				},
			];
		}
		case "assistant":
			return assistantItems(entry.id, message, stamp, context);
		case "toolResult":
			return [toolResultItem(entry.id, message, context, stamp)];
		case "bashExecution":
			return bashItems(entry.id, message, stamp);
		case "custom":
			return activityOf(entry.id, stamp, message);
		default:
			return [];
	}
}

function userContent(
	content: Content,
	entryId: string | undefined,
	prompt: PromptRecord | undefined,
	cwd: string | undefined,
): { text: string; attachments: AttachmentRef[] } {
	if (typeof content === "string") {
		const raw = typedText(content);
		const extracted = extractUserImagePaths(raw, cwd);
		return { text: extracted.text, attachments: [...extracted.files] };
	}
	const texts: string[] = [];
	const attachments: AttachmentRef[] = [];
	let imageNumber = 0;
	(content ?? []).forEach((block, index) => {
		if (block.type === "text") {
			texts.push(block.text);
			return;
		}
		if (block.type !== "image") return;
		const name = prompt?.imageNames[imageNumber] ?? undefined;
		imageNumber += 1;
		const ref = entryId === undefined ? undefined : imageRefOf(entryId, index, block, name);
		if (ref && attachments.length < MAX_LIST_ITEMS) attachments.push(ref);
	});
	const raw = typedText(texts.join("\n"));
	if (imageNumber > 0) return { text: raw, attachments };
	const extracted = extractUserImagePaths(raw, cwd);
	return {
		text: extracted.text,
		attachments: [...attachments, ...extracted.files].slice(0, MAX_LIST_ITEMS),
	};
}

function imageRefOf(entryId: string, contentIndex: number, block: ImageContent, name?: string): ImageRef | undefined {
	if (block.mimeType === "") return undefined;
	return {
		kind: "image_ref",
		id: entryAttachmentId(entryId, contentIndex),
		mimeType: clipStart(block.mimeType, MAX_NAME_CHARS),
		...(name !== undefined && { name }),
	};
}

/**
 * One block per non-empty text or thinking block and one call per `toolCall`, at their `contentIndex`.
 * A thinking block Pi stores with no text (an encrypted reasoning signature alone) has nothing to show.
 * `content` may be missing in an old or hand-edited file, which Pi reads as empty.
 */
function assistantItems(
	entryId: string,
	message: AssistantMessage,
	stamp: Stamp,
	context: EntryContext,
): TranscriptItem[] {
	const items: TranscriptItem[] = [];
	const content = message.content ?? [];
	content.forEach((block, index) => {
		if (block.type === "toolCall") {
			items.push(toolCallItem(entryId, index, block, stamp, context.childSessions?.get(block.id)));
			return;
		}
		if (block.type !== "text" && block.type !== "thinking") return;
		const text = block.type === "text" ? block.text : block.thinking;
		if (text === "") return;
		items.push({
			kind: "block",
			id: entryItemId(entryId, index),
			...stamp,
			messageId: entryId,
			block: block.type,
			text: clipStart(text, MAX_TEXT_CHARS),
		});
	});
	const ending = endingText(message, content);
	if (ending !== undefined) {
		items.push({ kind: "notice", id: entryItemId(entryId, content.length), ...stamp, level: "error", text: ending });
	}
	return items;
}

/**
 * What Pi's terminal shows under a message that did not end normally (pi-coding-agent 1.5.2
 * `dist/modes/interactive/components/assistant-message.js:162-177`): a cut-off response, or the error or abort of a message
 * with no tool calls (a call's own result shows its failure).
 */
function endingText(message: AssistantMessage, content: AssistantMessage["content"]): string | undefined {
	if (message.stopReason === "length") return "Response was truncated before completion.";
	if (content.some((block) => block.type === "toolCall")) return undefined;
	const reason = message.errorMessage;
	if (message.stopReason === "aborted") {
		return phoneText(reason && reason !== "Request was aborted" ? reason : "Operation aborted");
	}
	if (message.stopReason === "error") return phoneText(`Error: ${reason || "Unknown error"}`);
	return undefined;
}

function toolCallItem(
	entryId: string,
	contentIndex: number,
	call: ToolCall,
	stamp: Stamp,
	childSession: SessionRef | undefined,
): TranscriptItem {
	return {
		kind: "tool_call",
		id: entryItemId(entryId, contentIndex),
		...stamp,
		toolCallId: storedToolCallId(entryId, contentIndex),
		messageId: entryId,
		name: toolNameOf(call.name),
		input: boundedJson(call.arguments),
		...(childSession !== undefined && { childSession }),
	};
}

function toolResultItem(
	entryId: string,
	message: ToolResultMessage,
	context: EntryContext,
	stamp: Stamp,
): TranscriptItem {
	const content = message.content;
	const isError = message.isError === true;
	const changes = fileChangesOf(
		message.toolName,
		context.toolInput === undefined ? null : boundedJson(context.toolInput),
		message.details === undefined ? undefined : boundedJson(message.details),
	);
	const imageRef = (index: number): ImageRef | undefined => {
		const block = content?.[index];
		return block?.type === "image" ? imageRefOf(entryId, index, block) : undefined;
	};
	return {
		kind: "tool_result",
		id: entryItemId(entryId, 0),
		...stamp,
		toolCallId: context.toolCallId ?? storedToolCallId(entryId, 0),
		outcome: toolOutcome({
			isError,
			denied: context.toolOutcome === "denied",
			aborted: context.toolOutcome === "aborted",
		}),
		result: toolResultOf(content, isError, changes, imageRef, message.details, {
			name: message.toolName,
			input: context.toolInput,
		}),
	};
}

function noticeOf(entryId: string, stamp: Stamp, text: string | undefined): TranscriptItem[] {
	const shown = text === undefined ? "" : phoneText(text);
	return shown === "" ? [] : [{ kind: "notice", id: entryItemId(entryId, 0), ...stamp, level: "info", text: shown }];
}

/** An extension's message, when it is shown (`display`); its images have no place in an activity. */
function activityOf(
	entryId: string,
	stamp: Stamp,
	message: {
		readonly customType: unknown;
		readonly content: Content;
		readonly display: boolean;
		readonly details?: unknown;
	},
): TranscriptItem[] {
	if (message.display !== true) return [];
	const activity = customActivity(message.customType, message.content ?? [], message.details);
	return activity === undefined ? [] : [{ kind: "activity", id: entryItemId(entryId, 0), ...stamp, activity }];
}

function modelChangeItems(entry: ModelChangeEntry, stamp: Stamp): TranscriptItem[] {
	const model = { provider: entry.provider, id: entry.modelId };
	if (!hasWireId(model)) return [];
	return [{ kind: "model_change", id: entryItemId(entry.id, 0), ...stamp, modelId: modelWireId(model) }];
}

function thinkingChangeItems(entry: ThinkingLevelChangeEntry, stamp: Stamp): TranscriptItem[] {
	if (typeof entry.thinkingLevel !== "string") return [];
	return [
		{
			kind: "model_change",
			id: entryItemId(entry.id, 0),
			...stamp,
			thinking: clipStart(entry.thinkingLevel, MAX_NAME_CHARS),
		},
	];
}

/** An entry's `timestamp` is an ISO string Pi wrote; a date it cannot read leaves the item with no time. */
function timestampOf(timestamp: string): number | undefined {
	const ms = Date.parse(timestamp);
	return isCount(ms) ? ms : undefined;
}
