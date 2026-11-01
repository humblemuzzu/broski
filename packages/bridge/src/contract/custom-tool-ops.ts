/**
 * Tools the bridge itself serves to its agent (protocol 1.4), each defined by the person: what it is called, what it
 * takes, and what runs when it is called. They belong to the bridge, not to a project or a session, so the ops name
 * neither. `custom_tools` lists them with their actions (test, delete; a test's output is the list's `note`);
 * `custom_tool` reads and writes one definition as JSON text, under the rules of an `EditableFile`.
 */

import { z } from "zod";
import { ActionList, ActionListChange } from "./action-list";
import { EditableFile, EditableFileChange } from "./editable-file";
import { MAX_ID_CHARS } from "./limits";

/** The op kinds that list and edit the bridge's own tools (since 1.4, `ADDED_IN_MINOR.configOps`). */
export const CUSTOM_TOOL_OP_KINDS = ["custom_tools", "custom_tool"] as const;

/** Every tool defined; a row's id is the `toolId` `custom_tool` takes. */
export const CustomToolsOp = z.strictObject({
	kind: z.literal("custom_tools"),
	change: ActionListChange.optional(),
});
export type CustomToolsOp = z.infer<typeof CustomToolsOp>;

export const CustomToolsListed = z.strictObject({
	kind: z.literal("custom_tools"),
	list: ActionList,
});
export type CustomToolsListed = z.infer<typeof CustomToolsListed>;

/**
 * One definition. `toolId` absent: a new one, answered as a starting template (`exists` false) under an id no tool
 * has yet; a write to that id at the template's revision creates the tool. A `toolId` no tool has is `not_found` for
 * a read. A definition that is not valid JSON, or not a valid tool, is `invalid_input`; another revision is `stale`.
 */
export const CustomToolOp = z.strictObject({
	kind: z.literal("custom_tool"),
	toolId: z.string().min(1).max(MAX_ID_CHARS).optional(),
	change: EditableFileChange.optional(),
});
export type CustomToolOp = z.infer<typeof CustomToolOp>;

export const CustomToolRead = z.strictObject({
	kind: z.literal("custom_tool"),
	file: EditableFile,
});
export type CustomToolRead = z.infer<typeof CustomToolRead>;
