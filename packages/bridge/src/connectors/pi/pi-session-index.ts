/**
 * Lightweight index of a Pi session JSONL file.
 *
 * One sequential pass records, per entry, only `type` / `id` / `parentId` plus the entry's byte
 * range, so the session tree can be resolved without holding any entry body in memory. Bodies are
 * read afterwards, by byte offset, for the entries a caller actually needs.
 *
 * The three fields come from the head of the line via a small JSON scanner; when the head does not
 * contain them the line is read whole and parsed with `JSON.parse`.
 */

import { type FileHandle, open } from "node:fs/promises";
import type { FileEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { readJsonlLineSpans } from "../../utils/jsonl-line-spans";

export type PiSessionEntryRef = {
	type: string;
	id: string | null;
	parentId: string | null;
	offset: number;
	length: number;
};

export type PiSessionFileIndex = {
	/** Non-header entries in file order. */
	entries: PiSessionEntryRef[];
	/** `id` -> position in `entries`; a repeated id keeps the last one, as `parseSessionEntries` does. */
	byId: Map<string, number>;
	/** `version` of the first `session` header line, or 1 when the file has none readable. */
	headerVersion: number;
	/** Set when an entry carries a non-string `id` / `parentId`, where keying by string would differ. */
	unreliable: boolean;
};

type HeadFields = {
	type?: string | null;
	id?: string | null;
	parentId?: string | null;
};

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COLON = 0x3a;

function endOfString(text: string, start: number): number {
	let from = start + 1;
	for (;;) {
		const quote = text.indexOf('"', from);
		if (quote === -1) return -1;
		let backslashes = 0;
		for (let i = quote - 1; i >= 0 && text.charCodeAt(i) === BACKSLASH; i--) backslashes++;
		if (backslashes % 2 === 0) return quote;
		from = quote + 1;
	}
}

function nextNonSpace(text: string, start: number): number {
	let i = start;
	while (i < text.length && text.charCodeAt(i) <= 0x20) i++;
	return i;
}

function readFieldValue(text: string, key: string, start: number): string | null | undefined {
	if (key !== "type" && key !== "id" && key !== "parentId") return undefined;
	if (start >= text.length) return undefined;
	if (text.charCodeAt(start) === QUOTE) {
		const end = endOfString(text, start);
		return end === -1 ? undefined : text.slice(start + 1, end);
	}
	if (text.startsWith("null", start)) return null;
	return undefined;
}

function assignField(fields: HeadFields, key: string, value: string | null): void {
	fields[key as keyof HeadFields] = value;
}

/** Reads the top-level `type` / `id` / `parentId` of one entry line from its head. */
export function scanEntryHead(head: string): HeadFields {
	const fields: HeadFields = {};
	let depth = 0;
	let i = nextNonSpace(head, 0);

	while (i < head.length) {
		const code = head.charCodeAt(i);
		if (code === QUOTE) {
			const end = endOfString(head, i);
			if (end === -1) return fields;
			if (depth === 1 && head.charCodeAt(nextNonSpace(head, end + 1)) === COLON) {
				const key = head.slice(i + 1, end);
				const value = readFieldValue(head, key, nextNonSpace(head, nextNonSpace(head, end + 1) + 1));
				if (value !== undefined) assignField(fields, key, value);
			}
			i = end + 1;
			continue;
		}
		if (code === OPEN_OBJECT || code === OPEN_ARRAY) depth++;
		else if (code === CLOSE_OBJECT || code === CLOSE_ARRAY) {
			depth--;
			if (depth <= 0) return fields;
		}
		i++;
	}

	return fields;
}

function parseLine(text: string): FileEntry | null {
	if (!text.trim()) return null;
	try {
		return JSON.parse(text) as FileEntry;
	} catch {
		return null;
	}
}

type RawEntry = { type?: unknown; id?: unknown; parentId?: unknown };

function asRawEntry(entry: FileEntry): RawEntry {
	return entry as RawEntry;
}

function refOf(entry: FileEntry, offset: number, length: number): PiSessionEntryRef | null {
	const record = asRawEntry(entry);
	const type = typeof record.type === "string" ? record.type : null;
	if (!type || type === "session") return null;
	return {
		type,
		id: typeof record.id === "string" ? record.id : null,
		parentId: typeof record.parentId === "string" ? record.parentId : null,
		offset,
		length,
	};
}

async function readLineAt(handle: FileHandle, offset: number, length: number): Promise<string> {
	if (length <= 0) return "";
	const buffer = Buffer.allocUnsafe(length);
	const { bytesRead } = await handle.read(buffer, 0, length, offset);
	return buffer.subarray(0, bytesRead).toString("utf8");
}

export async function readPiEntryLines(
	path: string,
	refs: Array<PiSessionEntryRef | undefined>,
): Promise<Array<SessionEntry | null>> {
	const handle = await open(path, "r");
	try {
		const out: Array<SessionEntry | null> = [];
		for (const ref of refs) {
			if (!ref) {
				out.push(null);
				continue;
			}
			const parsed = parseLine(await readLineAt(handle, ref.offset, ref.length));
			out.push(parsed ? (parsed as SessionEntry) : null);
		}
		return out;
	} finally {
		await handle.close();
	}
}

export async function readPiEntryAt(path: string, ref: PiSessionEntryRef): Promise<SessionEntry | null> {
	const [entry] = await readPiEntryLines(path, [ref]);
	return entry ?? null;
}

const VERSION_PATTERN = /"version"\s*:\s*(\d+)/;

function idIsKeyable(value: unknown): boolean {
	return value === null || value === undefined || typeof value === "string";
}

export async function indexPiSessionFile(path: string): Promise<PiSessionFileIndex> {
	const entries: PiSessionEntryRef[] = [];
	const byId = new Map<string, number>();
	let headerVersion = 1;
	let unreliable = false;
	let handle: FileHandle | null = null;

	const push = (ref: PiSessionEntryRef): void => {
		const position = entries.length;
		entries.push(ref);
		if (ref.id !== null) byId.set(ref.id, position);
	};

	try {
		for await (const span of readJsonlLineSpans(path)) {
			if (span.length <= 0) continue;
			const fields = scanEntryHead(span.head);
			const headResolved = fields.type !== undefined && fields.id !== undefined && fields.parentId !== undefined;

			if (fields.type === "session") {
				headerVersion = readHeaderVersion(span) ?? headerVersion;
				continue;
			}

			if (headResolved) {
				push({
					type: fields.type as string,
					id: fields.id ?? null,
					parentId: fields.parentId ?? null,
					offset: span.offset,
					length: span.length,
				});
				continue;
			}

			handle ??= await open(path, "r");
			const parsed = parseLine(await readLineAt(handle, span.offset, span.length));
			if (!parsed) continue;
			const record = asRawEntry(parsed);
			if (!idIsKeyable(record.id) || !idIsKeyable(record.parentId)) unreliable = true;
			const ref = refOf(parsed, span.offset, span.length);
			if (ref) push(ref);
		}
	} finally {
		await handle?.close();
	}

	return { entries, byId, headerVersion, unreliable };
}

function readHeaderVersion(span: { head: string; length: number }): number | null {
	const match = VERSION_PATTERN.exec(span.head);
	if (match?.[1]) {
		const version = Number.parseInt(match[1], 10);
		if (Number.isFinite(version)) return version;
	}
	return null;
}
