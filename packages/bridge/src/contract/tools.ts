import { z } from "zod";
import { FileChange, FileContent, ImageRef, TextContent, WebUrl } from "./content";
import { SessionRef } from "./ids";
import { JsonValue } from "./json";
import { MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "./limits";

export const ToolContent = z.discriminatedUnion("kind", [TextContent, ImageRef, FileContent]);
export type ToolContent = z.infer<typeof ToolContent>;

export const ToolOutcome = z.enum(["completed", "failed", "denied", "aborted"]);
export type ToolOutcome = z.infer<typeof ToolOutcome>;

export const TodoStatus = z.enum(["pending", "in_progress", "completed"]);
export type TodoStatus = z.infer<typeof TodoStatus>;

export const TodoItem = z.strictObject({ text: z.string().min(1).max(MAX_TEXT_CHARS), status: TodoStatus });
export type TodoItem = z.infer<typeof TodoItem>;

/** The agent's task list, whole, as the call left it. */
export const TodosDisplay = z.strictObject({
	kind: z.literal("todos"),
	items: z.array(TodoItem).min(1).max(MAX_LIST_ITEMS),
});
export type TodosDisplay = z.infer<typeof TodosDisplay>;

export const LinkItem = z.strictObject({
	title: z.string().max(MAX_NAME_CHARS),
	url: WebUrl,
	snippet: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type LinkItem = z.infer<typeof LinkItem>;

/** Pages a search found. */
export const LinksDisplay = z.strictObject({
	kind: z.literal("links"),
	items: z.array(LinkItem).min(1).max(MAX_LIST_ITEMS),
});
export type LinksDisplay = z.infer<typeof LinksDisplay>;

/** Files a search found; `total` when there were more than `paths` holds. */
export const FilesDisplay = z.strictObject({
	kind: z.literal("files"),
	paths: z.array(z.string().min(1).max(MAX_PATH_CHARS)).min(1).max(MAX_LIST_ITEMS),
	total: z.int().nonnegative().optional(),
});
export type FilesDisplay = z.infer<typeof FilesDisplay>;

/** Text the agent's tool wrote as markdown (a subagent's report, a fetched page), drawn formatted. */
export const MarkdownDisplay = z.strictObject({
	kind: z.literal("markdown"),
	text: z.string().min(1).max(MAX_TEXT_CHARS),
});
export type MarkdownDisplay = z.infer<typeof MarkdownDisplay>;

/**
 * Lines of a file as a read returned them, without any line-number prefixes: `firstLine` is the number of the first,
 * `note` what the tool said about the rest ("Showing lines 1-2000 of 4512").
 */
export const FileTextDisplay = z.strictObject({
	kind: z.literal("file_text"),
	path: z.string().min(1).max(MAX_PATH_CHARS),
	firstLine: z.int().positive(),
	text: z.string().max(MAX_TEXT_CHARS),
	note: z.string().min(1).max(MAX_NAME_CHARS).optional(),
});
export type FileTextDisplay = z.infer<typeof FileTextDisplay>;

/**
 * What a result shows in place of its text, when its tool has a view of its own; any other result, and one whose list is
 * empty, shows its text.
 */
export const ToolDisplay = z.discriminatedUnion("kind", [
	TodosDisplay,
	LinksDisplay,
	FilesDisplay,
	MarkdownDisplay,
	FileTextDisplay,
]);
export type ToolDisplay = z.infer<typeof ToolDisplay>;

export const ToolResult = z.strictObject({
	content: z.array(ToolContent).max(MAX_LIST_ITEMS),
	fileChanges: z.array(FileChange).max(MAX_LIST_ITEMS),
	error: z.string().max(MAX_TEXT_CHARS).optional(),
	exitCode: z.int().optional(),
	display: ToolDisplay.optional(),
});
export type ToolResult = z.infer<typeof ToolResult>;

/** The complete input, once a backend that streams tool arguments has finished streaming them. */
export const ToolInputSet = z.strictObject({ kind: z.literal("input"), input: JsonValue });
export type ToolInputSet = z.infer<typeof ToolInputSet>;

export const ToolOutputAppended = z.strictObject({
	kind: z.literal("output_appended"),
	text: z.string().max(MAX_TEXT_CHARS),
});
export type ToolOutputAppended = z.infer<typeof ToolOutputAppended>;

export const ToolOutputReplaced = z.strictObject({
	kind: z.literal("output_replaced"),
	text: z.string().max(MAX_TEXT_CHARS),
});
export type ToolOutputReplaced = z.infer<typeof ToolOutputReplaced>;

export const ToolProgress = z.strictObject({ kind: z.literal("progress"), message: z.string().max(MAX_TEXT_CHARS) });
export type ToolProgress = z.infer<typeof ToolProgress>;

/** Replaces the tool's file changes so far. */
export const ToolFileChanges = z.strictObject({
	kind: z.literal("file_changes"),
	changes: z.array(FileChange).max(MAX_LIST_ITEMS),
});
export type ToolFileChanges = z.infer<typeof ToolFileChanges>;

/** The session this tool call runs in, for a call that spawns a subagent. */
export const ToolChildSession = z.strictObject({ kind: z.literal("child_session"), session: SessionRef });
export type ToolChildSession = z.infer<typeof ToolChildSession>;

export const ToolUpdate = z.discriminatedUnion("kind", [
	ToolInputSet,
	ToolOutputAppended,
	ToolOutputReplaced,
	ToolProgress,
	ToolFileChanges,
	ToolChildSession,
]);
export type ToolUpdate = z.infer<typeof ToolUpdate>;
