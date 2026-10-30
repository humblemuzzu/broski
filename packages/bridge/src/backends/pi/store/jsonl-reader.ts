/**
 * Reads a Pi session file without writing it (D6): LF-split line spans, the header, each entry by its
 * byte span, migration in memory, and the branch to a leaf walked with a visited set.
 */

import type { FileHandle } from "node:fs/promises";
import { CURRENT_SESSION_VERSION, type SessionEntry, type SessionHeader } from "@earendil-works/pi-coding-agent";
import { MAX_ID_CHARS } from "../../../contract";
import { isUsableEntryId } from "../ids";
import { asRecord, type LineKind, lineKind, parseJson, stringOf } from "./entry-line";
import { type LineVisitor, readText, type ScannedLine, type ScanSignal, scanLines } from "./line-scanner";
import { isSessionEntry, positionalId, toCurrentVersion } from "./migration";
import { openRegularFile } from "./open-file";

/** A file's identity at one moment; an index read at another stamp is stale (D7). */
export interface FileStamp {
	readonly size: number;
	readonly mtimeMs: number;
	readonly ino: number;
	readonly ctimeMs: number;
}

export function stampOf(stats: FileStamp): FileStamp {
	return { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino, ctimeMs: stats.ctimeMs };
}

export function sameStamp(a: FileStamp, b: FileStamp): boolean {
	return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.ctimeMs === b.ctimeMs;
}

/** Where one entry's line lies in the file. */
export interface EntrySpan {
	readonly entryId: string;
	readonly parentId: string | null;
	readonly type: string;
	/** A message's role when the line's first bytes say it. */
	readonly role: string | undefined;
	/** The entry's index among the file's parsed lines, the header being 0. */
	readonly ordinal: number;
	readonly offset: number;
	readonly length: number;
}

/** One pass over a file: its header and every readable entry line, in file order. */
export interface SessionFileIndex {
	readonly path: string;
	readonly stamp: FileStamp;
	readonly header: SessionHeader;
	/** The header's `version`, 1 when it names none. Below 3 the entries are migrated in memory on read. */
	readonly version: number;
	/** Where the header line ends; an append never moves it, Pi's rewrite of an old file does. */
	readonly headerEnd: number;
	readonly entries: readonly EntrySpan[];
	readonly byId: ReadonlyMap<string, number>;
}

/**
 * Past this many entries a file is refused instead of indexed, so one session cannot make the index hold hundreds
 * of megabytes of spans (one costs about 200 bytes).
 */
export const MAX_INDEXED_ENTRIES = 1_000_000;

/** Pi stops looking for a header after this many bytes (`MAX_SESSION_HEADER_SCAN_BYTES`, pi-coding-agent `src/core/session-manager.ts:607`). */
const MAX_HEADER_SCAN_BYTES = 1024 * 1024;

/**
 * The header a line holds, as Pi's discovery reads it (`parseSessionHeaderCandidate`, `:677-683`):
 * undefined for a blank or malformed line (skipped), null for a first entry that is not a session header.
 */
function parseHeader(text: string): SessionHeader | null | undefined {
	const record = asRecord(parseJson(text));
	if (record === undefined) return undefined;
	const id = stringOf(record.id);
	if (record.type !== "session" || id === undefined || id.length === 0 || id.length > MAX_ID_CHARS) return null;
	return {
		type: "session",
		id,
		timestamp: stringOf(record.timestamp) ?? "",
		cwd: stringOf(record.cwd) ?? "",
		...versionOf(record.version),
		...(typeof record.parentSession === "string" && { parentSession: record.parentSession }),
	};
}

/**
 * The version Pi's migration acts on. It compares the header's value with `<` and `>=` (`migrateToCurrentVersion`,
 * pi-coding-agent `src/core/session-manager.ts:337-347`), which convert it as `Number()` does: `"2"` is 2, and a
 * value that converts to no number passes neither test, so nothing is migrated, as for the current version.
 */
function versionOf(value: unknown): { version?: number } {
	if (value === undefined || value === null) return {};
	const version = Number(value);
	return { version: Number.isNaN(version) ? CURRENT_SESSION_VERSION : version };
}

/** The header of the file open as `handle`; undefined when the file is not a Pi session. */
export async function readHeader(handle: FileHandle, size: number): Promise<SessionHeader | undefined> {
	let found: SessionHeader | undefined;
	await scanLines(handle, 0, Math.min(size, MAX_HEADER_SCAN_BYTES), async (line) => {
		const parsed = await headerOfLine(handle, line);
		if (parsed === undefined) return undefined;
		found = parsed ?? undefined;
		return "stop";
	});
	return found;
}

/** `parseHeader` of a line; null for a line too long to read, which is no header. */
async function headerOfLine(handle: FileHandle, line: ScannedLine): Promise<SessionHeader | null | undefined> {
	const text = await readText(handle, line.offset, line.length);
	return text === undefined ? null : parseHeader(text);
}

class SpanIndexer {
	header: SessionHeader | undefined;
	version = 3;
	headerEnd = 0;
	readonly entries: EntrySpan[] = [];
	tooMany = false;
	private ordinal = 0;

	constructor(private readonly handle: FileHandle) {}

	readonly visit: LineVisitor = async (line) => {
		if (this.header === undefined) return this.visitHeader(line);
		const kind = await lineKind(this.handle, line);
		if (kind === undefined) return undefined;
		this.ordinal += 1;
		const span = this.spanOf(kind, line);
		if (span !== undefined) this.entries.push(span);
		if (this.entries.length <= MAX_INDEXED_ENTRIES) return undefined;
		this.tooMany = true;
		return "stop";
	};

	private async visitHeader(line: ScannedLine): Promise<ScanSignal> {
		if (line.offset >= MAX_HEADER_SCAN_BYTES) return "stop";
		const parsed = await headerOfLine(this.handle, line);
		if (parsed === null) return "stop";
		if (parsed === undefined) return undefined;
		this.header = parsed;
		this.headerEnd = line.offset + line.length;
		this.version = parsed.version ?? 1;
		return undefined;
	}

	private spanOf(kind: LineKind, line: ScannedLine): EntrySpan | undefined {
		if (kind.type === "session") return undefined;
		const entryId = this.version < 2 ? positionalId(this.ordinal) : kind.id;
		if (entryId === undefined || !isUsableEntryId(entryId)) return undefined;
		const parentId =
			this.version < 2 ? (this.ordinal > 1 ? positionalId(this.ordinal - 1) : null) : (kind.parentId ?? null);
		return {
			entryId,
			parentId,
			type: kind.type,
			role: kind.role,
			ordinal: this.ordinal,
			offset: line.offset,
			length: line.length,
		};
	}
}

/**
 * Undefined for a missing file, an empty one, or one whose first line is not a Pi session header; `too_large` past
 * `MAX_INDEXED_ENTRIES`. A last line with no `\n` is an entry only when it is complete JSON, so a writer mid-append
 * never shows a torn entry.
 */
export async function indexSessionFile(path: string): Promise<SessionFileIndex | "too_large" | undefined> {
	const handle = await openRegularFile(path);
	if (handle === undefined) return undefined;
	try {
		const stats = await handle.stat();
		if (stats.size === 0) return undefined;
		const indexer = new SpanIndexer(handle);
		await scanLines(handle, 0, stats.size, indexer.visit);
		if (indexer.tooMany) return "too_large";
		return indexer.header === undefined ? undefined : fileIndex(path, stats, indexer, indexer.header);
	} finally {
		await handle.close();
	}
}

function fileIndex(path: string, stats: FileStamp, indexer: SpanIndexer, header: SessionHeader): SessionFileIndex {
	const byId = new Map<string, number>();
	indexer.entries.forEach((span, position) => {
		byId.set(span.entryId, position);
	});
	return {
		path,
		stamp: stampOf(stats),
		header,
		version: indexer.version,
		headerEnd: indexer.headerEnd,
		entries: indexer.entries,
		byId,
	};
}

/**
 * The entries at `spans`, parsed and migrated, aligned with `spans`: undefined for a line that no longer
 * parses, whose id is no longer the span's (the file changed under the index), or whose type is not one Pi writes.
 */
export async function readEntries(
	index: SessionFileIndex,
	spans: readonly EntrySpan[],
): Promise<(SessionEntry | undefined)[]> {
	if (spans.length === 0) return [];
	const handle = await openRegularFile(index.path);
	if (handle === undefined) return spans.map(() => undefined);
	try {
		const entries: (SessionEntry | undefined)[] = [];
		for (const span of spans) entries.push(await entryAt(handle, index, span));
		return entries;
	} finally {
		await handle.close();
	}
}

async function entryAt(
	handle: FileHandle,
	index: SessionFileIndex,
	span: EntrySpan,
): Promise<SessionEntry | undefined> {
	const text = await readText(handle, span.offset, span.length);
	const value = text === undefined ? undefined : parseJson(text);
	if (!isSessionEntry(value) || value.type !== span.type) return undefined;
	if (index.version >= 2 && value.id !== span.entryId) return undefined;
	return toCurrentVersion(index.version, span.ordinal, value);
}

/** The entries from the root to `leafEntryId`, oldest first; a parent cycle or a missing parent ends the walk (D6). */
export function branchTo(index: SessionFileIndex, leafEntryId: string | null): EntrySpan[] {
	const branch: EntrySpan[] = [];
	const seen = new Set<number>();
	let position = leafEntryId === null ? undefined : index.byId.get(leafEntryId);
	while (position !== undefined && !seen.has(position)) {
		seen.add(position);
		const span = index.entries[position];
		if (span === undefined) break;
		branch.push(span);
		position = span.parentId === null ? undefined : index.byId.get(span.parentId);
	}
	return branch.reverse();
}

/**
 * Whether the file is still the one `file` indexed with lines only added: the same inode, no shorter, and the
 * header line ending where it did. Anything else (replaced, truncated, rewritten by Pi's migration) makes
 * the spans, and what was read through them, untrustworthy.
 */
export async function isStillAppendedTo(file: SessionFileIndex): Promise<boolean> {
	const handle = await openRegularFile(file.path);
	if (handle === undefined) return false;
	try {
		const stats = await handle.stat();
		if (stats.ino !== file.stamp.ino || stats.size < file.stamp.size) return false;
		const byte = Buffer.alloc(1);
		const { bytesRead } = await handle.read(byte, 0, 1, file.headerEnd);
		return bytesRead === 1 && byte[0] === 0x0a;
	} finally {
		await handle.close();
	}
}

/** The leaf Pi would open the file at: the last entry in file order (`_buildIndex`, `:1103-1122`). */
export function lastEntryId(index: SessionFileIndex): string | null {
	return index.entries.at(-1)?.entryId ?? null;
}
