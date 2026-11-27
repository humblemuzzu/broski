/** The bytes behind an `ImageRef` of the transcript (`ids.ts` `imageAttachmentId`). */

import { imageRead } from "../../../adapter-kit/image-read";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import {
	type AttachmentId,
	type AttachmentReadResult,
	type ImageVariant,
	MAX_IMAGE_CHARS,
	type SessionId,
} from "../../../contract";
import { parseImageAttachmentId } from "../ids";
import { imageAt, imageRefsOf } from "../mapping/images";
import { openChain } from "./chain-reader";
import { sourceOf } from "./chain-sources";
import type { StoreContext } from "./context";
import { rawContent } from "./message-parts";

export async function readImage(
	ctx: StoreContext,
	sessionId: SessionId,
	attachment: AttachmentId,
	variant: ImageVariant = "full",
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
	const fitImage = ctx.deps.services.fitImage;
	const image = imageAt(content, part, fitImage !== undefined ? null : MAX_IMAGE_CHARS);
	if (image === undefined) return rejected("not_found", "no such attachment");
	const place = imageRefsOf(content, part.entryUuid).findIndex((ref) => ref.id === attachment);
	const name = ctx.deps.ownership.prompt(sessionId, part.entryUuid)?.imageNames[place];
	return imageRead(image, variant, fitImage, name);
}
