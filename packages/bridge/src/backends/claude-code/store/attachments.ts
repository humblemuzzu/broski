/** The bytes behind an `ImageRef` of the transcript (`ids.ts` `imageAttachmentId`). */

import {
	type AttachmentId,
	type AttachmentReadResult,
	type ImageContent,
	type ImageVariant,
	MAX_IMAGE_CHARS,
	MAX_NAME_CHARS,
	type SessionId,
} from "../../../contract";
import { clip } from "../bounds";
import { parseImageAttachmentId } from "../ids";
import { imageAt, imageRefsOf } from "../mapping/images";
import { isRejected, rejected } from "../rejections";
import type { ImageFitter } from "../services";
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
	return formatImageRead(image, variant, fitImage, name);
}

export async function formatImageRead(
	image: ImageContent,
	variant: ImageVariant,
	fitImage?: ImageFitter,
	nameOverride?: string,
): Promise<AttachmentReadResult> {
	const name = nameOverride ?? image.name;
	const cleanName = name !== undefined && name !== "" ? clip(name, MAX_NAME_CHARS) : undefined;
	if (fitImage !== undefined) {
		const fitted = await fitImage(image.data, image.mimeType, variant);
		if (!fitted.ok) {
			return rejected(fitted.reason === "too_large" ? "unsupported" : "backend_error", fitted.message);
		}
		return {
			status: "accepted",
			image: {
				kind: "image",
				mimeType: fitted.mimeType,
				data: fitted.data,
				...(cleanName !== undefined && { name: cleanName }),
			},
			...(fitted.width !== undefined && { width: fitted.width }),
			...(fitted.height !== undefined && { height: fitted.height }),
			originalBytes: fitted.originalBytes,
			resized: fitted.resized,
		};
	}
	if (image.data.length > MAX_IMAGE_CHARS) return rejected("unsupported", "the image is larger than the link carries");
	return {
		status: "accepted",
		image: {
			...image,
			...(cleanName !== undefined && { name: cleanName }),
		},
	};
}
