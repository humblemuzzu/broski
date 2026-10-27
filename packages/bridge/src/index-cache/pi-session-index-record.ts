/**
 * One persisted Pi session summary: the fields the bridge sends for a session plus the enrichment the
 * directory listing would otherwise recompute, keyed by the file's `(mtimeMs, size, ino, ctimeMs)`
 * stamp, as `FileFingerprintCache` does.
 */

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionDiffSummary } from "../handlers/session-stats";
import type { PiSessionInfo } from "../types/pi";
import { sessionPreview } from "../utils/session-preview";

export const PI_SESSION_INDEX_SCHEMA = 2;

/** Cache budget for the Pi session index; one record is a few hundred bytes to a few kilobytes. */
export const PI_SESSION_INDEX_MAX_BYTES = 128 * 1024 * 1024;

export const PI_SESSION_INDEX_FILE = "pi-session-index.jsonl";

export type PiSessionFileStamp = {
	mtimeMs: number;
	size: number;
	ino: number;
	ctimeMs: number;
};

export type PiSessionIndexRecord = {
	path: string;
	mtimeMs: number;
	size: number;
	ino: number;
	ctimeMs: number;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: number;
	modified: number;
	messageCount: number;
	firstMessage: string;
	summary?: SessionDiffSummary;
	subagentToolCount?: number;
	/** When this record was last computed, newest-first on disk so the byte budget drops the oldest. */
	at: number;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RawRecord) : null;
}

function readString(source: RawRecord, key: string): string | null {
	const value = source[key];
	return typeof value === "string" ? value : null;
}

function readNumber(source: RawRecord, key: string): number | null {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalNumber(source: RawRecord, key: string): number | undefined {
	const value = readNumber(source, key);
	return value === null ? undefined : value;
}

function readOptionalString(source: RawRecord, key: string): string | undefined {
	return readString(source, key) ?? undefined;
}

function readSummary(source: RawRecord): SessionDiffSummary | undefined {
	const summary = asRecord(source.summary);
	if (!summary) return undefined;
	const additions = readNumber(summary, "additions");
	const deletions = readNumber(summary, "deletions");
	const files = readNumber(summary, "files");
	if (additions === null || deletions === null || files === null) return undefined;
	return { additions, deletions, files };
}

function readStamp(source: RawRecord): PiSessionFileStamp | null {
	const mtimeMs = readNumber(source, "mtimeMs");
	const size = readNumber(source, "size");
	const ino = readNumber(source, "ino");
	const ctimeMs = readNumber(source, "ctimeMs");
	if (mtimeMs === null || size === null || ino === null || ctimeMs === null) return null;
	return { mtimeMs, size, ino, ctimeMs };
}

export function encodePiSessionIndexRecord(record: PiSessionIndexRecord): string {
	return JSON.stringify(record);
}

/** Null for any line that is not a complete record, so a truncated or foreign line is skipped. */
export function parsePiSessionIndexRecord(line: string): PiSessionIndexRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}

	const source = asRecord(parsed);
	if (!source) return null;
	const stamp = readStamp(source);
	const at = readNumber(source, "at");
	const path = readString(source, "path");
	const id = readString(source, "id");
	const cwd = readString(source, "cwd");
	const created = readNumber(source, "created");
	const modified = readNumber(source, "modified");
	const messageCount = readNumber(source, "messageCount");
	const firstMessage = readString(source, "firstMessage");
	if (!stamp || at === null || !path || id === null || cwd === null) return null;
	if (created === null || modified === null || messageCount === null || firstMessage === null) return null;

	return {
		path,
		mtimeMs: stamp.mtimeMs,
		size: stamp.size,
		ino: stamp.ino,
		ctimeMs: stamp.ctimeMs,
		id,
		cwd,
		name: readOptionalString(source, "name"),
		parentSessionPath: readOptionalString(source, "parentSessionPath"),
		created,
		modified,
		messageCount,
		firstMessage,
		summary: readSummary(source),
		subagentToolCount: readOptionalNumber(source, "subagentToolCount"),
		at,
	};
}

export function sessionFileStampMatches(record: PiSessionIndexRecord, stamp: PiSessionFileStamp): boolean {
	return (
		record.mtimeMs === stamp.mtimeMs &&
		record.size === stamp.size &&
		record.ino === stamp.ino &&
		record.ctimeMs === stamp.ctimeMs
	);
}

/** True when `candidate` describes a later version of a file than `current` does. */
export function isNewerSessionFileStamp(candidate: PiSessionFileStamp, current: PiSessionFileStamp): boolean {
	if (candidate.mtimeMs !== current.mtimeMs) return candidate.mtimeMs > current.mtimeMs;
	if (candidate.size !== current.size) return candidate.size > current.size;
	return candidate.ino > current.ino;
}

export function toPiSessionInfo(record: PiSessionIndexRecord): PiSessionInfo {
	return {
		path: record.path,
		id: record.id,
		cwd: record.cwd,
		name: record.name,
		parentSessionPath: record.parentSessionPath,
		created: record.created,
		modified: record.modified,
		messageCount: record.messageCount,
		firstMessage: sessionPreview(record.firstMessage),
		summary: record.summary,
		subagentToolCount: record.subagentToolCount,
	};
}

/** The SDK-shaped object the directory-cache listing returned, for callers that still want it. */
export function toSdkSessionInfo(record: PiSessionIndexRecord): SessionInfo {
	return {
		path: record.path,
		id: record.id,
		cwd: record.cwd,
		name: record.name,
		parentSessionPath: record.parentSessionPath,
		created: new Date(record.created),
		modified: new Date(record.modified),
		messageCount: record.messageCount,
		firstMessage: record.firstMessage,
		allMessagesText: "",
	};
}

export type PiSessionEnrichment = {
	summary: SessionDiffSummary | null;
	toolCount: number;
};

/**
 * Null when a timestamp is not a finite number, e.g. a session header with a broken timestamp: such a
 * file is recomputed on every listing instead of being stored as a record the parser would reject.
 */
export function recordFromSessionInfo(
	info: SessionInfo,
	stamp: PiSessionFileStamp,
	enrichment: PiSessionEnrichment,
	at: number,
): PiSessionIndexRecord | null {
	const created = info.created.getTime();
	const modified = info.modified.getTime();
	if (!Number.isFinite(created) || !Number.isFinite(modified)) return null;

	const record: PiSessionIndexRecord = {
		path: info.path,
		mtimeMs: stamp.mtimeMs,
		size: stamp.size,
		ino: stamp.ino,
		ctimeMs: stamp.ctimeMs,
		id: info.id,
		cwd: info.cwd,
		name: info.name,
		parentSessionPath: info.parentSessionPath,
		created,
		modified,
		messageCount: info.messageCount,
		firstMessage: info.firstMessage,
		at,
	};
	if (
		enrichment.summary &&
		(enrichment.summary.additions > 0 || enrichment.summary.deletions > 0 || enrichment.summary.files > 0)
	) {
		record.summary = enrichment.summary;
	}
	if (enrichment.toolCount > 0) record.subagentToolCount = enrichment.toolCount;
	return record;
}
