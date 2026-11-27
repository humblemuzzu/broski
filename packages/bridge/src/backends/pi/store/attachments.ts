/** `readAttachment`: the image block an `<entryId>:<contentIndex>` or `ts:<timestamp>:<contentIndex>` id names. */

import { imageRead, type StoredImage } from "../../../adapter-kit/image-read";
import {
	type AttachmentId,
	type AttachmentReadResult,
	type ImageVariant,
	MAX_NAME_CHARS,
	type SessionId,
} from "../../../contract";
import { parseEntryPart } from "../ids";
import type { ImageFitter } from "../ports";
import { rejected } from "../rejections";
import type { SessionEntry } from "./entries";
import { isStillAppendedTo, readEntries, type SessionFileIndex } from "./jsonl-reader";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

const TS_PREFIX = "ts:";
const TS_SCAN_WINDOW = 64;
const FLUSH_RETRY_MS = [35, 90, 200] as const;

export async function readAttachment(
	index: SessionIndex,
	sessionId: SessionId,
	attachment: AttachmentId,
	variant: ImageVariant = "full",
	fitImage?: ImageFitter,
): Promise<AttachmentReadResult> {
	const tsPart = parseTimestampPart(attachment);
	const entryPart = tsPart === undefined ? parseEntryPart(attachment) : undefined;
	if (tsPart === undefined && entryPart === undefined) return rejected("not_found", `no attachment ${attachment}`);

	const head = await index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no attachment ${attachment}`);

	if (tsPart !== undefined) {
		const found = await readByTimestamp(index, head.path, tsPart);
		if (found === undefined) return rejected("not_found", `no image ${attachment}`);
		return imageRead(found, variant, fitImage);
	}

	const file = await openFileIndex(index, head.path);
	if (isRejection(file)) return file;
	const position = file.byId.get(entryPart!.entryId);
	const span = position === undefined ? undefined : file.entries[position];
	const [entry] = span === undefined ? [] : await readEntries(file, [span]);
	const block = entry === undefined ? undefined : imageBlockAt(entry, entryPart!.index);
	if (block === undefined) {
		return (await isStillAppendedTo(file))
			? rejected("not_found", `no image ${attachment}`)
			: rejected("backend_error", "the session file was replaced or rewritten while it was read; read it again");
	}
	return imageRead(block, variant, fitImage);
}

interface TimestampPart {
	readonly timestamp: number;
	readonly index: number;
}

function parseTimestampPart(id: AttachmentId): TimestampPart | undefined {
	if (!id.startsWith(TS_PREFIX)) return undefined;
	const parts = id.slice(TS_PREFIX.length).split(":");
	if (parts.length !== 2) return undefined;
	const timestamp = Number(parts[0]);
	const index = Number(parts[1]);
	if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isSafeInteger(index) || index < 0) return undefined;
	return { timestamp, index };
}

async function readByTimestamp(
	index: SessionIndex,
	path: string,
	part: TimestampPart,
): Promise<StoredImage | undefined> {
	for (let attempt = 0; attempt <= FLUSH_RETRY_MS.length; attempt += 1) {
		const file = await openFileIndex(index, path);
		if (!isRejection(file)) {
			const block = await scanTailForTimestamp(file, part);
			if (block !== undefined) return block;
		}
		const wait = FLUSH_RETRY_MS[attempt];
		if (wait === undefined) break;
		await new Promise((resolve) => setTimeout(resolve, wait));
	}
	return undefined;
}

async function scanTailForTimestamp(file: SessionFileIndex, part: TimestampPart): Promise<StoredImage | undefined> {
	const candidates = file.entries
		.slice(-TS_SCAN_WINDOW)
		.filter((span) => span.type === "message" && (span.role === "user" || span.role === "toolResult"));
	if (candidates.length === 0) return undefined;
	const entries = await readEntries(file, candidates);
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (entry?.type !== "message") continue;
		if (entry.message.role !== "user" && entry.message.role !== "toolResult") continue;
		if (entry.message.timestamp !== part.timestamp) continue;
		const block = imageBlockAt(entry, part.index);
		if (block !== undefined) return block;
	}
	return undefined;
}

/** An image block of a user message or a tool result; other entries and non-image blocks hold none. */
function imageBlockAt(entry: SessionEntry, index: number): StoredImage | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role !== "user" && message.role !== "toolResult") return undefined;
	const block = Array.isArray(message.content) ? message.content[index] : undefined;
	if (block?.type !== "image" || typeof block.data !== "string" || typeof block.mimeType !== "string") return undefined;
	const usable = block.data.length > 0 && block.mimeType.length > 0 && block.mimeType.length <= MAX_NAME_CHARS;
	return usable ? { data: block.data, mimeType: block.mimeType } : undefined;
}
