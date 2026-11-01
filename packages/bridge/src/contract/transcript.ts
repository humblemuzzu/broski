import { z } from "zod";
import { Activity } from "./activity";
import { CompactionTrigger } from "./compaction";
import { AttachmentRef, BlockKind } from "./content";
import { ClientRequestId, MessageId, ModelId, SessionRef, Timestamp, ToolCallId, TranscriptItemId } from "./ids";
import { JsonValue } from "./json";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";
import { NoticeLevel } from "./notice";
import { MAX_PAGE_LIMIT, PageCursor } from "./paging";
import { RunOutcome } from "./runs";
import { ToolOutcome, ToolResult } from "./tools";

export const UserMessageItem = z.strictObject({
	kind: z.literal("user_message"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	text: z.string().max(MAX_TEXT_CHARS),
	attachments: z.array(AttachmentRef).max(MAX_LIST_ITEMS),
	clientRequestId: ClientRequestId.optional(),
});
export type UserMessageItem = z.infer<typeof UserMessageItem>;

/** One text, thinking or plan block of an assistant message; blocks of one message share `messageId`. */
export const BlockItem = z.strictObject({
	kind: z.literal("block"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	messageId: MessageId,
	block: BlockKind,
	text: z.string().max(MAX_TEXT_CHARS),
	parentToolCallId: ToolCallId.optional(),
});
export type BlockItem = z.infer<typeof BlockItem>;

export const ToolCallItem = z.strictObject({
	kind: z.literal("tool_call"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	toolCallId: ToolCallId,
	messageId: MessageId.optional(),
	name: z.string().min(1).max(MAX_NAME_CHARS),
	title: z.string().max(MAX_NAME_CHARS).optional(),
	input: JsonValue.optional(),
	parentToolCallId: ToolCallId.optional(),
	childSession: SessionRef.optional(),
});
export type ToolCallItem = z.infer<typeof ToolCallItem>;

export const ToolResultItem = z.strictObject({
	kind: z.literal("tool_result"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	toolCallId: ToolCallId,
	outcome: ToolOutcome,
	result: ToolResult,
});
export type ToolResultItem = z.infer<typeof ToolResultItem>;

export const NoticeItem = z.strictObject({
	kind: z.literal("notice"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	level: NoticeLevel,
	text: z.string().max(MAX_TEXT_CHARS),
});
export type NoticeItem = z.infer<typeof NoticeItem>;

export const CompactionItem = z.strictObject({
	kind: z.literal("compaction"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	trigger: CompactionTrigger.optional(),
	summary: z.string().max(MAX_TEXT_CHARS).optional(),
	tokensBefore: z.int().nonnegative().optional(),
	tokensAfter: z.int().nonnegative().optional(),
});
export type CompactionItem = z.infer<typeof CompactionItem>;

export const ModelChangeItem = z.strictObject({
	kind: z.literal("model_change"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	modelId: ModelId.optional(),
	thinking: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ModelChangeItem = z.infer<typeof ModelChangeItem>;

/** Where a run ended, for backends that record it in history. */
export const RunBoundaryItem = z.strictObject({
	kind: z.literal("run_boundary"),
	id: TranscriptItemId,
	at: Timestamp.optional(),
	outcome: RunOutcome,
});
export type RunBoundaryItem = z.infer<typeof RunBoundaryItem>;

/** A harness activity, such as a hook that ran (since 1.4; a client below it reads a `notice` with the same `id`). */
export const ActivityItem = z.strictObject({
	kind: z.literal("activity"),
	at: Timestamp.optional(),
	...Activity.shape,
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const TranscriptItem = z.discriminatedUnion("kind", [
	UserMessageItem,
	BlockItem,
	ToolCallItem,
	ToolResultItem,
	NoticeItem,
	CompactionItem,
	ModelChangeItem,
	RunBoundaryItem,
	ActivityItem,
]);
export type TranscriptItem = z.infer<typeof TranscriptItem>;

/**
 * `stable`: every id in the page is the same on every read. `positional`: ids are synthesised from
 * position and may differ between reads or from the live stream's ids.
 */
export const IdStability = z.enum(["stable", "positional"]);
export type IdStability = z.infer<typeof IdStability>;

/** Finished runs only: the items of a run still active in an open session are in its snapshot's `run.items`. */
export const TranscriptPage = z.strictObject({
	items: z.array(TranscriptItem).max(MAX_PAGE_LIMIT),
	nextCursor: PageCursor.optional(),
	idStability: IdStability,
});
export type TranscriptPage = z.infer<typeof TranscriptPage>;
