/** The bytes behind an `ImageRef` of the transcript (`ids.ts` `imageAttachmentId`). */

import {
	type AttachmentId,
	type AttachmentReadResult,
	MAX_IMAGE_CHARS,
	MAX_NAME_CHARS,
	type SessionId,
} from "../../../contract";
import { clip } from "../bounds";
import { parseImageAttachmentId } from "../ids";
import { imageAt, imageRefsOf } from "../mapping/images";
import { isRejected, rejected } from "../rejections";
import { openChain } from "./chain-reader";
import { sourceOf } from "./chain-sources";
import type { StoreContext } from "./context";
import { rawContent } from "./message-parts";

export async function readImage(
	ctx: StoreContext,
	sessionId: SessionId,
	attachment: AttachmentId,
): Promise<AttachmentReadResult> {
	const part = parseImageAttachmentId(attachment);
	if (part === undefined) return rejected("not_found", "no such attachment");
	const opened = await sourceOf(ctx, sessionId);
	if (isRejected(opened)) return opened;
	const snapshot = await openChain(ctx, opened.source);
	if (isRejected(snapshot)) return snapshot;
	const position = snapshot.index.positions.get(part.entryUuid);
	if (position === undefined) return rejected("not_found", "no such attachment");
	const window = await snapshot.window(position, 1);
	if (isRejected(window)) return window;
	const content = window[0] === undefined ? undefined : rawContent(window[0]);
	const image = imageAt(content, part);
	if (image === undefined) return rejected("not_found", "no such attachment");
	if (image.data.length > MAX_IMAGE_CHARS) return rejected("unsupported", "the image is larger than the link carries");
	const place = imageRefsOf(content, part.entryUuid).findIndex((ref) => ref.id === attachment);
	const name = ctx.deps.ownership.prompt(sessionId, part.entryUuid)?.imageNames[place];
	return {
		status: "accepted",
		image: {
			...image,
			...(name !== undefined && name !== "" && { name: clip(name, MAX_NAME_CHARS) }),
		},
	};
}
