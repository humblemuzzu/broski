/**
 * `export_session` and `export_part`: a session written aside as HTML or as its file, and read back in parts. The
 * file is the session's own, every branch, up to its last complete line; the HTML is the terminal's `/export`.
 */

import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	type BackendCallResult,
	type ExportPartOp,
	type ExportSessionOp,
	MAX_NAME_CHARS,
	type SessionExportFormat,
} from "../../../contract";
import { clipStart } from "../bounds";
import { errorText } from "../error-text";
import type { SessionStore } from "../ports";
import { rejected } from "../rejections";
import { isFileSystemError } from "../store/open-file";
import type { ExportDesk, ExportedFile, ExportSlot } from "../transfer/export-desk";
import { type HtmlRenderSource, renderHtml } from "../transfer/html-render";
import { readPart } from "../transfer/part-io";
import { copyCompleteLines } from "../transfer/session-copy";

export interface ExportDeps {
	readonly store: Pick<SessionStore, "locate">;
	readonly desk: ExportDesk;
	readonly html: HtmlRenderSource;
}

const FORMATS: Record<SessionExportFormat, { readonly extension: string; readonly mimeType: string }> = {
	html: { extension: ".html", mimeType: "text/html" },
	jsonl: { extension: ".jsonl", mimeType: "application/x-ndjson" },
};

export async function exportSession(deps: ExportDeps, op: ExportSessionOp): Promise<BackendCallResult> {
	const stored = await deps.store.locate(op.sessionId);
	if ("status" in stored) return stored;
	const format = FORMATS[op.format];
	const slot = await deps.desk.slot();
	const name = clipStart(`${basename(stored.path, ".jsonl")}${format.extension}`, MAX_NAME_CHARS);
	try {
		const path = await write(deps, slot, op.format, stored);
		if (path === undefined) return rejected("not_found", "the session file is gone or is no longer a file");
		const file = await deps.desk.keep(slot, { sessionId: op.sessionId, path, name, mimeType: format.mimeType });
		return { status: "accepted", result: { kind: "export_session", ...summaryOf(file) } };
	} catch (error) {
		await deps.desk.abandon(slot);
		return rejected("backend_error", `the session could not be exported: ${errorText(error)}`);
	}
}

export async function exportPart(deps: ExportDeps, op: ExportPartOp): Promise<BackendCallResult> {
	const file = deps.desk.find(op.exportId, op.sessionId);
	if (file === undefined) {
		return rejected("not_found", "this export is gone: the Mac keeps only the newest few. Export the session again.");
	}
	if (op.offset > file.bytes || (op.offset === file.bytes && file.bytes > 0)) {
		return rejected("invalid_input", `offset ${op.offset} is past the end of the ${file.bytes} bytes`);
	}
	try {
		const part = await readPart(file.path, op.offset, file.bytes);
		if (part === undefined) return rejected("backend_error", "the export file is shorter than it was");
		return { status: "accepted", result: { kind: "export_part", offset: op.offset, ...part } };
	} catch (error) {
		if (!isFileSystemError(error)) throw error;
		return rejected("backend_error", `the export could not be read: ${errorText(error)}`);
	}
}

function summaryOf(file: ExportedFile) {
	return { exportId: file.exportId, name: file.name, mimeType: file.mimeType, bytes: file.bytes };
}

/** The path of the finished file; undefined when the session file is no longer a regular file. */
async function write(
	deps: ExportDeps,
	slot: ExportSlot,
	format: SessionExportFormat,
	stored: { readonly path: string; readonly cwd: string | undefined },
): Promise<string | undefined> {
	const copy = join(slot.dir, "session.jsonl");
	if ((await copyCompleteLines(stored.path, copy)) === undefined) return undefined;
	if (format === "jsonl") return copy;
	const html = join(slot.dir, "session.html");
	await renderHtml(deps.html, stored.cwd, copy, html);
	await rm(copy);
	return html;
}
