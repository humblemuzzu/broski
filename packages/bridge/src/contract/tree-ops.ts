import { z } from "zod";
import { SessionId, Timestamp, TranscriptItemId } from "./ids";
import { MAX_ID_CHARS, MAX_NAME_CHARS } from "./limits";
import { MAX_PAGE_LIMIT, PageCursor, PageRequest } from "./paging";

/** The op kinds that read and edit a session's tree (since 1.3, `ADDED_IN_MINOR.treeOps`). */
export const TREE_OP_KINDS = ["read_tree", "label_entry", "abort_branch_summary"] as const;

/** Characters of a node's text the tree shows; a longer text is cut and `previewCut` says so. */
export const TREE_PREVIEW_CHARS = 280;

const EntryId = z.string().min(1).max(MAX_ID_CHARS);

export const TreeNodeKind = z.enum([
	"user",
	"assistant",
	"assistant_tools",
	"tool_result",
	"bash",
	"custom_message",
	"compaction",
	"branch_summary",
	"model_change",
	"thinking_change",
	"session_info",
	"label",
	"custom",
	"context_edit",
]);
export type TreeNodeKind = z.infer<typeof TreeNodeKind>;

/**
 * One entry of a session's tree. `assistant_tools` is an assistant message that only calls tools. `itemId` is what
 * `navigate_tree` takes to move the session to this node.
 */
export const TreeNode = z.strictObject({
	id: EntryId,
	/** The nearest shown ancestor; absent for a root. */
	parentId: EntryId.optional(),
	itemId: TranscriptItemId,
	kind: TreeNodeKind,
	at: Timestamp.optional(),
	preview: z.string().max(TREE_PREVIEW_CHARS),
	previewCut: z.boolean(),
	label: z.string().max(MAX_NAME_CHARS).optional(),
});
export type TreeNode = z.infer<typeof TreeNode>;

/** Pi: the session's tree, newest entry first, a page at a time. */
export const ReadTreeOp = z.strictObject({
	kind: z.literal("read_tree"),
	sessionId: SessionId,
	page: PageRequest,
});
export type ReadTreeOp = z.infer<typeof ReadTreeOp>;

/** Pi: set the label of an entry; no `label` (or a blank one) clears it. */
export const LabelEntryOp = z.strictObject({
	kind: z.literal("label_entry"),
	sessionId: SessionId,
	entryId: EntryId,
	label: z.string().max(MAX_NAME_CHARS).optional(),
});
export type LabelEntryOp = z.infer<typeof LabelEntryOp>;

/** Pi: cancel the branch summary a `navigate_tree` call is writing. Accepted when none is. */
export const AbortBranchSummaryOp = z.strictObject({
	kind: z.literal("abort_branch_summary"),
	sessionId: SessionId,
});
export type AbortBranchSummaryOp = z.infer<typeof AbortBranchSummaryOp>;

/** `leafId` is the shown node the session stands on; `total` counts every shown node, on every page. */
export const TreeRead = z.strictObject({
	kind: z.literal("read_tree"),
	leafId: EntryId.optional(),
	total: z.int().nonnegative(),
	nodes: z.array(TreeNode).max(MAX_PAGE_LIMIT),
	nextCursor: PageCursor.optional(),
});
export type TreeRead = z.infer<typeof TreeRead>;

export const EntryLabelled = z.strictObject({ kind: z.literal("label_entry") });
export type EntryLabelled = z.infer<typeof EntryLabelled>;

export const BranchSummaryAborted = z.strictObject({ kind: z.literal("abort_branch_summary") });
export type BranchSummaryAborted = z.infer<typeof BranchSummaryAborted>;
