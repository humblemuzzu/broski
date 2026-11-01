/**
 * One text file a person reads and edits from the phone (protocol 1.4): a backend's configuration file, or one
 * definition of a tool the bridge serves. Writes are compare-and-swap on `revision`, so an edit made against a copy that
 * changed since is refused `stale` rather than lost; a JSON file that does not parse is refused `invalid_input`, never
 * written; a file the backend may not change is refused `unsupported`.
 */

import { z } from "zod";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "./limits";

/** How the text reads: `json` is checked strictly before it is written. */
export const EditableFileFormat = z.enum(["json", "markdown", "text"]);
export type EditableFileFormat = z.infer<typeof EditableFileFormat>;

/** Opaque, minted by the backend for one state of the file; a file that does not exist has one too. */
export const EditableFileRevision = z.string().min(1).max(MAX_ID_CHARS);
export type EditableFileRevision = z.infer<typeof EditableFileRevision>;

/**
 * The file as it is now. `exists` false: there is no such file yet, `text` is empty or a starting template, and a
 * write creates it. `truncated`: the file is longer than `text` holds, so it is never `editable` here (a write would
 * replace the whole file with the part shown). `problems` say what is wrong with the file as it stands, such as a JSON
 * parse error the backend skips the file for.
 */
export const EditableFile = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	path: z.string().min(1).max(MAX_PATH_CHARS),
	scope: z.string().min(1).max(MAX_NAME_CHARS),
	format: EditableFileFormat,
	exists: z.boolean(),
	text: z.string().max(MAX_TEXT_CHARS),
	revision: EditableFileRevision,
	editable: z.boolean(),
	truncated: z.boolean(),
	problems: z.array(z.string().max(MAX_TEXT_CHARS)).max(MAX_LIST_ITEMS),
});
export type EditableFile = z.infer<typeof EditableFile>;

/** Replace the file's whole text, or create it, if it is still at `revision`. */
export const EditableFileWrite = z.strictObject({
	kind: z.literal("write"),
	text: z.string().max(MAX_TEXT_CHARS),
	revision: EditableFileRevision,
});
export type EditableFileWrite = z.infer<typeof EditableFileWrite>;

/** Remove the file, if it is still at `revision`. */
export const EditableFileDelete = z.strictObject({
	kind: z.literal("delete"),
	revision: EditableFileRevision,
});
export type EditableFileDelete = z.infer<typeof EditableFileDelete>;

export const EditableFileChange = z.discriminatedUnion("kind", [EditableFileWrite, EditableFileDelete]);
export type EditableFileChange = z.infer<typeof EditableFileChange>;
