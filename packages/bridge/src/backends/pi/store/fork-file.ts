/**
 * Writes the file of a fork: a v3 header naming the source, the `broski.origin` entry that makes the fork
 * this bridge's own, and the branch up to the fork point as `forkContents` lays it out. The source is read by span, never opened
 * with `SessionManager` (D6), and the new file appears whole or not at all.
 */

import { type FileHandle, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "@earendil-works/pi-coding-agent";
import { isOriginEntry, ORIGIN_ENTRY } from "../broski-entries";
import { errorText } from "../error-text";
import { readPrefix } from "./entry-line";
import { type ForkedEntry, forkContents } from "./fork-entries";
import { type EntrySpan, readEntries, type SessionFileIndex } from "./jsonl-reader";
import { readBytes } from "./line-scanner";
import { isFileSystemError, openRegularFile } from "./open-file";

/** Lines are gathered up to about this many bytes before each write. */
const WRITE_BATCH_BYTES = 1024 * 1024;

export interface ForkPlan {
	readonly source: SessionFileIndex;
	/** The branch to copy, root first. */
	readonly spans: readonly EntrySpan[];
	readonly directory: string;
	readonly header: SessionHeader;
	/** The id for a new `broski.origin` entry, which roots the fork; undefined when the branch holds one. */
	readonly originId: string | undefined;
}

/** The path of the new file, or the reason it could not be written. */
export async function writeForkFile(plan: ForkPlan): Promise<{ path: string } | { failure: string }> {
	const path = join(plan.directory, `${plan.header.timestamp.replace(/[:.]/g, "-")}_${plan.header.id}.jsonl`);
	const temp = `${path}.tmp`;
	let out: FileHandle | undefined;
	try {
		await mkdir(plan.directory, { recursive: true });
		out = await open(temp, "wx");
		const failure = await writeLines(plan, out);
		await out.close();
		out = undefined;
		if (failure === undefined) {
			await rename(temp, path);
			return { path };
		}
		await unlink(temp);
		return { failure };
	} catch (error) {
		await out?.close().catch(() => undefined);
		await unlink(temp).catch(() => undefined);
		if (isFileSystemError(error)) return { failure: errorText(error) };
		throw error;
	}
}

async function writeLines(plan: ForkPlan, out: FileHandle): Promise<string | undefined> {
	await out.write(`${JSON.stringify(plan.header)}\n`);
	if (plan.originId !== undefined) await out.write(originLine(plan.originId, plan.header.timestamp));
	const contents = await forkContents(plan.source, plan.spans, plan.originId ?? null);
	const source = await openRegularFile(plan.source.path);
	if (source === undefined) return "the session file is gone";
	try {
		let batch: Buffer[] = [];
		let bytes = 0;
		for (const entry of contents.entries) {
			const line = await copiedLine(plan.source, source, entry);
			if (line === undefined)
				return "an entry of the session is too large to copy, or the file changed while it was copied";
			batch.push(line);
			bytes += line.length;
			if (bytes >= WRITE_BATCH_BYTES) {
				await out.write(Buffer.concat(batch));
				batch = [];
				bytes = 0;
			}
		}
		for (const label of contents.labels) batch.push(Buffer.from(`${JSON.stringify(label)}\n`));
		if (batch.length > 0) await out.write(Buffer.concat(batch));
		return undefined;
	} finally {
		await source.close();
	}
}

function originLine(id: string, timestamp: string): string {
	return `${JSON.stringify({ type: "custom", customType: ORIGIN_ENTRY, id, parentId: null, timestamp })}\n`;
}

/**
 * One entry as the fork keeps it, newline included. A current-version entry that keeps its parent is copied
 * byte for byte; any other is written as JSON: an older file's migrated (the fork's header says v3), and one
 * re-chained or re-pointed by `forkContents`.
 */
async function copiedLine(
	file: SessionFileIndex,
	source: FileHandle,
	forked: ForkedEntry,
): Promise<Buffer | undefined> {
	const { span } = forked;
	const rewrite = span.parentId !== forked.parentId || forked.firstKeptEntryId !== undefined;
	if (file.version >= CURRENT_SESSION_VERSION && !rewrite) {
		const raw = await readBytes(source, span.offset, span.length);
		return raw === undefined || !isEntryLine(raw, span) ? undefined : Buffer.concat([raw, Buffer.from("\n")]);
	}
	const [entry] = await readEntries(file, [span]);
	if (entry === undefined) return undefined;
	const firstKept = forked.firstKeptEntryId === undefined ? {} : { firstKeptEntryId: forked.firstKeptEntryId };
	return Buffer.from(`${JSON.stringify({ ...entry, parentId: forked.parentId, ...firstKept })}\n`);
}

/** A cheap check that the bytes at a span are still the entry the index saw there. */
function isEntryLine(raw: Buffer, span: EntrySpan): boolean {
	const end = raw.at(-1) === 0x0d ? raw.length - 1 : raw.length;
	if (raw[0] !== 0x7b || raw[end - 1] !== 0x7d) return false;
	const prefix = readPrefix(raw.toString("latin1", 0, 512));
	return prefix === undefined || prefix.id === span.entryId;
}

/** Whether `spans` hold a `broski.origin` entry: the fork of a session this bridge made is already its own. */
export async function holdsOrigin(file: SessionFileIndex, spans: readonly EntrySpan[]): Promise<boolean> {
	const customs = spans.filter((span) => span.type === "custom");
	return (await readEntries(file, customs)).some((entry) => entry !== undefined && isOriginEntry(entry));
}
