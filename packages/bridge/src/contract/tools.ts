import { z } from "zod";
import { FileChange, FileContent, ImageRef, TextContent } from "./content";
import { SessionRef } from "./ids";
import { JsonValue } from "./json";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "./limits";

export const ToolContent = z.discriminatedUnion("kind", [TextContent, ImageRef, FileContent]);
export type ToolContent = z.infer<typeof ToolContent>;

export const ToolOutcome = z.enum(["completed", "failed", "denied", "aborted"]);
export type ToolOutcome = z.infer<typeof ToolOutcome>;

export const ToolResult = z.strictObject({
	content: z.array(ToolContent).max(MAX_LIST_ITEMS),
	fileChanges: z.array(FileChange).max(MAX_LIST_ITEMS),
	error: z.string().max(MAX_TEXT_CHARS).optional(),
	exitCode: z.int().optional(),
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
