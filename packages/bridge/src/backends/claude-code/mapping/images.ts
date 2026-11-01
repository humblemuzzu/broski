/** Lane B · images in user content: `ImageRef`s by `imageAttachmentId`, and the bytes behind one. Shared with A. */

import type { ImageContent, ImageRef } from "../../../contract";
import type { ImagePart } from "../ids";

export function imageRefsOf(_content: unknown, _entryUuid: string): ImageRef[] {
	return [];
}

export function imageAt(_content: unknown, _part: ImagePart): ImageContent | undefined {
	return undefined;
}
