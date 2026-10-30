import { z } from "zod";
import { SessionId } from "./ids";
import { MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TRANSFER_PART_CHARS } from "./limits";

/**
 * Pi: session files moving between the Mac and the phone, in parts of `MAX_TRANSFER_PART_BYTES` so every frame fits the
 * link. The kinds are spelled out, not taken from `BackendOpKind`, because `backend-ops.ts` imports this file.
 */

export const SessionExportFormat = z.enum(["html", "jsonl"]);
export type SessionExportFormat = z.infer<typeof SessionExportFormat>;

export const ExportId = z.string().min(1).max(MAX_ID_CHARS);
export type ExportId = z.infer<typeof ExportId>;

/** Chosen by the phone for one upload; the Mac keeps what it has received under it until the last part or the bridge ends. */
export const UploadId = z.string().min(1).max(MAX_ID_CHARS);
export type UploadId = z.infer<typeof UploadId>;

/** One part of a file as base64. */
const TransferData = z.string().max(MAX_TRANSFER_PART_CHARS);

/**
 * Render the session as the terminal's `/export` does (`html`), or copy its file whole, every branch (`jsonl`). The Mac
 * writes it aside and answers with what the phone then reads part by part with `export_part`.
 */
export const ExportSessionOp = z.strictObject({
	kind: z.literal("export_session"),
	sessionId: SessionId,
	format: SessionExportFormat,
});
export type ExportSessionOp = z.infer<typeof ExportSessionOp>;

/** The part of an export that starts at byte `offset`; the offsets of one read follow each other from 0. */
export const ExportPartOp = z.strictObject({
	kind: z.literal("export_part"),
	sessionId: SessionId,
	exportId: ExportId,
	offset: z.int().nonnegative(),
});
export type ExportPartOp = z.infer<typeof ExportPartOp>;

/**
 * Put the next part of a session file into the sessions directory the file's own project uses. The parts of one
 * `uploadId` arrive in order, `offset` being the bytes already sent; the `last` one checks the whole file as Pi reads
 * session files, refuses a bad one, never replaces a session, and answers with the new session's id.
 */
export const ImportSessionOp = z.strictObject({
	kind: z.literal("import_session"),
	uploadId: UploadId,
	offset: z.int().nonnegative(),
	data: TransferData,
	last: z.boolean(),
});
export type ImportSessionOp = z.infer<typeof ImportSessionOp>;

/** What the file is called and how large it is; its bytes follow with `export_part`. */
export const SessionExported = z.strictObject({
	kind: z.literal("export_session"),
	exportId: ExportId,
	name: z.string().min(1).max(MAX_NAME_CHARS),
	mimeType: z.string().min(1).max(MAX_NAME_CHARS),
	bytes: z.int().nonnegative(),
});
export type SessionExported = z.infer<typeof SessionExported>;

/** `done` once the part reaches the end of the file. */
export const ExportPartRead = z.strictObject({
	kind: z.literal("export_part"),
	offset: z.int().nonnegative(),
	data: TransferData,
	done: z.boolean(),
});
export type ExportPartRead = z.infer<typeof ExportPartRead>;

/** `received` bytes are held; `sessionId` is present exactly after the last part, when the session is in the list. */
export const SessionImported = z.strictObject({
	kind: z.literal("import_session"),
	received: z.int().nonnegative(),
	sessionId: SessionId.optional(),
});
export type SessionImported = z.infer<typeof SessionImported>;
