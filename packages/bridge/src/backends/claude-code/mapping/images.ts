/** Lane B · images in user content: `ImageRef`s by `imageAttachmentId`, and the bytes behind one. Shared with A. */

import { type ImageContent, type ImageRef, MAX_IMAGE_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS } from "../../../contract";
import { clip } from "../bounds";
import { type ImagePart, imageAttachmentId } from "../ids";
import { isRecord } from "../json";

interface Base64Image {
	readonly mimeType: string;
	readonly data: string;
}

/** A base64 image block (`ImageBlockParam` with a `Base64ImageSource`); a URL or file source holds no bytes to read. */
export function base64ImageOf(block: unknown): Base64Image | undefined {
	if (!isRecord(block) || block.type !== "image" || !isRecord(block.source)) return undefined;
	const { type, media_type: mimeType, data } = block.source;
	if (type !== "base64" || typeof mimeType !== "string" || typeof data !== "string") return undefined;
	return mimeType === "" || data === "" ? undefined : { mimeType: clip(mimeType, MAX_NAME_CHARS), data };
}

/** The images of a user entry's `message.content`, in order, each by the id `readAttachment` reads it with. */
export function imageRefsOf(content: unknown, entryUuid: string): ImageRef[] {
	if (!Array.isArray(content)) return [];
	const refs: ImageRef[] = [];
	content.forEach((block: unknown, index) => {
		const image = base64ImageOf(block);
		if (image === undefined || refs.length >= MAX_LIST_ITEMS) return;
		refs.push({
			kind: "image_ref",
			id: imageAttachmentId(entryUuid, index),
			mimeType: image.mimeType,
		});
	});
	return refs;
}

/** The bytes of one image of a user entry's content, or of an image inside its tool result; undefined when absent or too large. */
export function imageAt(content: unknown, part: ImagePart): ImageContent | undefined {
	if (!Array.isArray(content)) return undefined;
	const outer: unknown = content[part.blockIndex];
	const block = part.innerIndex === undefined ? outer : innerBlock(outer, part.innerIndex);
	const image = base64ImageOf(block);
	if (image === undefined || image.data.length > MAX_IMAGE_CHARS) return undefined;
	return { kind: "image", mimeType: image.mimeType, data: image.data };
}

function innerBlock(outer: unknown, innerIndex: number): unknown {
	if (!isRecord(outer) || outer.type !== "tool_result" || !Array.isArray(outer.content)) return undefined;
	return outer.content[innerIndex];
}
