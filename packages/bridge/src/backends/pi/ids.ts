/**
 * Every id the adapter hands the core (contract README §4): minted live ids, ids derived from session
 * entries, and the per-run table from Pi's tool call ids to live ones.
 */

import {
	type AttachmentId,
	type BlockId,
	type InteractionId,
	MAX_ID_CHARS,
	type MessageId,
	type QueueItemId,
	type RunId,
	type SessionId,
	type ToolCallId,
	type TranscriptItemId,
} from "../../contract";

/** Random, so no id is ever reused in a session (stream rule 2). */
function mint(): string {
	return crypto.randomUUID();
}

export const mintRunId: () => RunId = mint;
/** Pi gives a message an entry id only once it is persisted, after it ends (`src/core/agent-session.ts:1144-1166`). */
export const mintMessageId: () => MessageId = mint;
export const mintInteractionId: () => InteractionId = mint;
export const mintQueueItemId: () => QueueItemId = mint;
/** A live activity's item id; the transcript names the same activity by its entry (`entryItemId`). */
export const mintActivityId: () => TranscriptItemId = mint;

export function blockId(messageId: MessageId, contentIndex: number): BlockId {
	return `${messageId}:${contentIndex}`;
}

/** Pi mints 8 hex characters or a UUID; a longer id is not Pi's, and this leaves room for `:<index>`. */
export const MAX_ENTRY_ID_CHARS = 128;

export function isUsableEntryId(entryId: string): boolean {
	return entryId.length > 0 && entryId.length <= MAX_ENTRY_ID_CHARS;
}

export interface EntryPart {
	readonly entryId: string;
	readonly index: number;
}

/**
 * Index `0` for an entry that yields one item, the content index for an assistant message's blocks
 * and tool calls. Also the live `user_message` id, so a prompt's live and transcript ids are equal.
 */
export function entryItemId(entryId: string, index: number): TranscriptItemId {
	return `${entryId}:${index}`;
}

export function entryAttachmentId(entryId: string, contentIndex: number): AttachmentId {
	return `${entryId}:${contentIndex}`;
}

/** Split at the last `:`, so an entry id holding `:` still parses; undefined for an id not made here. */
export function parseEntryPart(id: string): EntryPart | undefined {
	const match = /^(.+):(0|[1-9]\d{0,8})$/.exec(id);
	if (!match) return undefined;
	const [, entryId = "", index = ""] = match;
	return isUsableEntryId(entryId) ? { entryId, index: Number(index) } : undefined;
}

const CHILD_SEPARATOR = ":";

/**
 * The id of the session a tool call's sub-run is shown as: its parent's id, then the provider's id of the call. Pi
 * session ids never hold a `:`; a parent that does (a hand-edited file) has no children.
 */
export function childSessionId(parentId: string, piToolCallId: string): SessionId | undefined {
	const id = `${parentId}${CHILD_SEPARATOR}${piToolCallId}`;
	return parentId.includes(CHILD_SEPARATOR) || piToolCallId === "" || id.length > MAX_ID_CHARS ? undefined : id;
}

export interface ChildSessionPart {
	readonly parentId: string;
	readonly piToolCallId: string;
}

export function parseChildSessionId(id: string): ChildSessionPart | undefined {
	const at = id.indexOf(CHILD_SEPARATOR);
	if (at <= 0 || at === id.length - 1) return undefined;
	return { parentId: id.slice(0, at), piToolCallId: id.slice(at + 1) };
}

/** Where the call sits: a provider's own id may be empty, repeat in a later response, or outgrow `ToolCallId`. */
export function storedToolCallId(assistantEntryId: string, contentIndex: number): ToolCallId {
	return entryItemId(assistantEntryId, contentIndex);
}

/**
 * A run's live tool call ids for the provider response under way, emptied by `nextResponse()` at
 * each assistant `message_start`: a provider id is unique at best within one response.
 */
export class ToolCallIds {
	private byPiId = new Map<string, ToolCallId>();
	private denied = new Set<string>();

	nextResponse(): void {
		this.byPiId = new Map();
		this.denied = new Set();
	}

	liveId(piToolCallId: string): ToolCallId {
		const known = this.byPiId.get(piToolCallId);
		if (known !== undefined) return known;
		const minted = mint();
		this.byPiId.set(piToolCallId, minted);
		return minted;
	}

	find(piToolCallId: string): ToolCallId | undefined {
		return this.byPiId.get(piToolCallId);
	}

	/** The permission gate blocked the call, so its result finishes `denied`. */
	deny(piToolCallId: string): void {
		this.denied.add(piToolCallId);
	}

	wasDenied(piToolCallId: string): boolean {
		return this.denied.has(piToolCallId);
	}
}
