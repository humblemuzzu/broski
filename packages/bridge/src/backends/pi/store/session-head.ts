/**
 * What a listing needs of one session file and can learn from its first and last bytes: the header,
 * and the last user or assistant message and the last model change in a window at the end. The rest of a
 * row (title, origin) is read only for the rows a page serves (`session-details.ts`).
 */

import type { FileHandle } from "node:fs/promises";
import { MAX_PATH_CHARS, type ModelId, type SessionId, type Timestamp } from "../../../contract";
import { hasWireId, modelWireId } from "../models/model-ids";
import { asRecord, type LineKind, lineKind, parseJson, stringOf } from "./entry-line";
import { type FileStamp, readHeader, stampOf } from "./jsonl-reader";
import { readText, type ScannedLine, scanLines } from "./line-scanner";
import { openRegularFile } from "./open-file";

export interface SessionHead {
	readonly sessionId: SessionId;
	readonly path: string;
	readonly stamp: FileStamp;
	/** The header `cwd` as Pi wrote it; undefined for `""`. */
	readonly cwd: string | undefined;
	readonly createdAt: Timestamp | undefined;
	/** Pi's `modified` (pi-coding-agent `src/core/session-manager.ts:859-865`), read from the file's tail. */
	readonly updatedAt: Timestamp;
	readonly parentPath: string | undefined;
	/** The last `model_change` or assistant message's model, as a wire id. */
	readonly modelId: ModelId | undefined;
}

const TAIL_FIRST_BYTES = 32 * 1024;
const TAIL_MAX_BYTES = 8 * 1024 * 1024;
const ACTIVITY_CANDIDATES = 64;

/** Undefined when the file is gone, empty, or not a Pi session. */
export async function readSessionHead(path: string): Promise<SessionHead | undefined> {
	const handle = await openRegularFile(path);
	if (handle === undefined) return undefined;
	try {
		const stats = await handle.stat();
		if (stats.size === 0) return undefined;
		const header = await readHeader(handle, stats.size);
		if (header === undefined) return undefined;
		const tail = await readTail(handle, stats.size);
		const created = validTime(Date.parse(header.timestamp));
		return {
			sessionId: header.id,
			path,
			stamp: stampOf(stats),
			cwd: header.cwd.length > 0 && header.cwd.length <= MAX_PATH_CHARS ? header.cwd : undefined,
			createdAt: created,
			updatedAt: tail.activityAt ?? created ?? validTime(Math.floor(stats.mtimeMs)) ?? 0,
			parentPath: header.parentSession,
			modelId: tail.modelId,
		};
	} finally {
		await handle.close();
	}
}

interface Tail {
	readonly activityAt: number | undefined;
	readonly modelId: ModelId | undefined;
}

/** The window grows until it holds a user or assistant message, to the file's start or `TAIL_MAX_BYTES`. */
async function readTail(handle: FileHandle, size: number): Promise<Tail> {
	let window = TAIL_FIRST_BYTES;
	for (;;) {
		const from = Math.max(0, size - window);
		const tail = await scanTail(handle, from, size);
		if (tail.activityAt !== undefined || from === 0 || window >= TAIL_MAX_BYTES) return tail;
		window *= 4;
	}
}

/**
 * Pi's `modified` is the maximum activity time over the whole file; here it is the maximum over the last
 * `ACTIVITY_CANDIDATES` messages in the window. Pi stamps a message when it creates it and appends nothing
 * that counts in between (an assistant message is stamped when its response starts; a queued one is
 * appended after it), so times fall along a file only if the clock does, and the maximum is among the last.
 * The window may begin inside a line; that piece is not JSON, so it is never read as an entry.
 */
async function scanTail(handle: FileHandle, from: number, size: number): Promise<Tail> {
	const candidates: ScannedLine[] = [];
	let model: { line: ScannedLine; kind: LineKind } | undefined;
	await scanLines(handle, from, size, async (line) => {
		if (!line.terminated) return undefined;
		const kind = await lineKind(handle, line);
		if (kind?.type === "message" && (kind.role === "user" || kind.role === "assistant")) {
			candidates.push(line);
			if (candidates.length > ACTIVITY_CANDIDATES) candidates.shift();
		}
		if (kind?.type === "model_change" || (kind?.type === "message" && kind.role === "assistant"))
			model = { line, kind };
		return undefined;
	});
	const times: number[] = [];
	for (const line of candidates) {
		const time = positiveTime(await activityTime(handle, line));
		if (time !== undefined) times.push(time);
	}
	return {
		activityAt: times.length === 0 ? undefined : Math.max(...times),
		modelId: model === undefined ? undefined : await modelOf(handle, model.line, model.kind),
	};
}

async function entryRecord(handle: FileHandle, line: ScannedLine, kind?: LineKind) {
	if (kind?.record !== undefined) return kind.record;
	const text = await readText(handle, line.offset, line.length);
	return text === undefined ? undefined : asRecord(parseJson(text));
}

/** The message's own `timestamp` (epoch ms), else the entry's ISO one: what Pi's `getMessageActivityTime` reads (`:785-797`). */
async function activityTime(handle: FileHandle, line: ScannedLine): Promise<number | undefined> {
	const entry = await entryRecord(handle, line);
	const messageTime = asRecord(entry?.message)?.timestamp;
	if (typeof messageTime === "number") return validTime(messageTime);
	return validTime(Date.parse(stringOf(entry?.timestamp) ?? ""));
}

async function modelOf(handle: FileHandle, line: ScannedLine, kind: LineKind): Promise<ModelId | undefined> {
	const entry = await entryRecord(handle, line, kind);
	const message = asRecord(entry?.message);
	const provider = stringOf(message?.provider ?? entry?.provider);
	const id = stringOf(message?.model ?? entry?.modelId);
	return provider !== undefined && id !== undefined && hasWireId({ provider, id })
		? modelWireId({ provider, id })
		: undefined;
}

function validTime(value: number): number | undefined {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

/** Pi counts only a positive activity time (`lastActivityTime > 0`, pi-coding-agent `src/core/session-manager.ts:860`). */
function positiveTime(value: number | undefined): number | undefined {
	return value !== undefined && value > 0 ? value : undefined;
}
