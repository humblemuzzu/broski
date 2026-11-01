import { z } from "zod";
import { FileChange } from "./content";
import { SessionId } from "./ids";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "./limits";

/** The op kinds that read what a session did and the models it can use (since 1.3, `ADDED_IN_MINOR.sessionFiles` and `modelAvailability`). */
export const READ_OP_KINDS = ["changed_files", "refresh_models"] as const;

/** The files the session's tool calls changed, each once, with the lines added and removed across all its edits. */
export const ChangedFilesOp = z.strictObject({
	kind: z.literal("changed_files"),
	sessionId: SessionId,
});
export type ChangedFilesOp = z.infer<typeof ChangedFilesOp>;

/** Read the model catalogues from the network as `pi update --models` does, then read every file Pi keeps about models again. */
export const RefreshModelsOp = z.strictObject({ kind: z.literal("refresh_models") });
export type RefreshModelsOp = z.infer<typeof RefreshModelsOp>;

/**
 * `files` holds at most `MAX_LIST_ITEMS` files, the most edited first, without diffs; `omitted` counts the rest. The
 * totals cover every file. A count a tool does not report (`write` knows no removed lines) is absent from the file.
 */
export const ChangedFilesListed = z.strictObject({
	kind: z.literal("changed_files"),
	files: z.array(FileChange).max(MAX_LIST_ITEMS),
	omitted: z.int().nonnegative(),
	additions: z.int().nonnegative(),
	deletions: z.int().nonnegative(),
});
export type ChangedFilesListed = z.infer<typeof ChangedFilesListed>;

/** Why some catalogue could not be refreshed; empty when all were. The phone's model list follows by `catalog_invalidated`. */
export const ModelsRefreshed = z.strictObject({
	kind: z.literal("refresh_models"),
	problems: z.array(z.string().max(MAX_TEXT_CHARS)).max(MAX_LIST_ITEMS),
});
export type ModelsRefreshed = z.infer<typeof ModelsRefreshed>;
