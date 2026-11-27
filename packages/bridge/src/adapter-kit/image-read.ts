import { type AttachmentReadResult, type ImageVariant, MAX_IMAGE_CHARS } from "../contract";
import type { ImageFitter } from "./ports";
import { rejected } from "./rejections";

export interface StoredImage {
	readonly data: string;
	readonly mimeType: string;
}

/** `attachment.read`'s answer for image bytes an adapter holds: fitted to `variant` when it can fit images. */
export async function imageRead(
	image: StoredImage,
	variant: ImageVariant,
	fitImage?: ImageFitter,
	name?: string,
): Promise<AttachmentReadResult> {
	const named = name !== undefined && name !== "" ? { name } : {};
	if (fitImage !== undefined) {
		const fitted = await fitImage(image.data, image.mimeType, variant);
		if (!fitted.ok) return rejected("backend_error", fitted.message);
		return {
			status: "accepted",
			image: { kind: "image", mimeType: fitted.mimeType, data: fitted.data, ...named },
			...(fitted.width !== undefined && { width: fitted.width }),
			...(fitted.height !== undefined && { height: fitted.height }),
			originalBytes: fitted.originalBytes,
			resized: fitted.resized,
		};
	}
	if (image.data.length > MAX_IMAGE_CHARS) {
		return rejected("backend_error", "the image is larger than the link can carry");
	}
	return { status: "accepted", image: { kind: "image", mimeType: image.mimeType, data: image.data, ...named } };
}
