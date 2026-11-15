/** `readAttachment`: the image block an `<entryId>:<contentIndex>` id names, read from the session file. */

import {
	type AttachmentId,
	type AttachmentReadResult,
	MAX_IMAGE_CHARS,
	MAX_NAME_CHARS,
	type SessionId,
} from "../../../contract";
import { parseEntryPart } from "../ids";
import { rejected } from "../rejections";
import type { SessionEntry } from "./entries";
import { isStillAppendedTo, readEntries } from "./jsonl-reader";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

export async function readAttachment(
	index: SessionIndex,
	sessionId: SessionId,
	attachment: AttachmentId,
): Promise<AttachmentReadResult> {
	const part = parseEntryPart(attachment);
	const head = part === undefined ? undefined : await index.find(sessionId);
	if (part === undefined || head === undefined) return rejected("not_found", `no attachment ${attachment}`);
	const file = await openFileIndex(index, head.path);
	if (isRejection(file)) return file;
	const position = file.byId.get(part.entryId);
	const span = position === undefined ? undefined : file.entries[position];
	const [entry] = span === undefined ? [] : await readEntries(file, [span]);
	const block = entry === undefined ? undefined : imageBlockAt(entry, part.index);
	if (block === undefined) {
		return (await isStillAppendedTo(file))
			? rejected("not_found", `no image ${attachment}`)
			: rejected("backend_error", "the session file was replaced or rewritten while it was read; read it again");
	}
	if (block.data.length > MAX_IMAGE_CHARS) {
		return rejected("backend_error", "the image is larger than the link can carry");
	}
	return { status: "accepted", image: { kind: "image", mimeType: block.mimeType, data: block.data } };
}

interface StoredImage {
	readonly data: string;
	readonly mimeType: string;
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
