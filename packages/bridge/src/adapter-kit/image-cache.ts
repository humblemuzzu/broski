import type { AttachmentId, ImageContent, ImageRef } from "../contract";

export interface ImageCacheBounds {
	readonly maxImages: number;
	/** Base64 characters of every image together. */
	readonly maxChars: number;
}

const DEFAULT_BOUNDS: ImageCacheBounds = { maxImages: 32, maxChars: 32 * 1_048_576 };

/**
 * The images a session's prompts carried, by the `AttachmentId` its events name them with, so `readAttachment` can
 * answer before the backend has them on disk. The least recently used go first once either bound is passed.
 */
export class ImageCache {
	private readonly entries = new Map<AttachmentId, ImageContent>();
	private chars = 0;

	constructor(private readonly bounds: ImageCacheBounds = DEFAULT_BOUNDS) {}

	/** Keeps `image` under `id` and answers the reference events name it by; an image over the whole bound is not kept. */
	put(id: AttachmentId, image: ImageContent): ImageRef {
		this.drop(id);
		if (image.data.length <= this.bounds.maxChars) {
			this.entries.set(id, image);
			this.chars += image.data.length;
			this.evict();
		}
		return { kind: "image_ref", id, mimeType: image.mimeType, ...(image.name !== undefined && { name: image.name }) };
	}

	get(id: AttachmentId): ImageContent | undefined {
		const image = this.entries.get(id);
		if (image === undefined) return undefined;
		this.entries.delete(id);
		this.entries.set(id, image);
		return image;
	}

	private drop(id: AttachmentId): void {
		const known = this.entries.get(id);
		if (known === undefined) return;
		this.entries.delete(id);
		this.chars -= known.data.length;
	}

	private evict(): void {
		for (const [id, image] of this.entries) {
			if (this.entries.size <= this.bounds.maxImages && this.chars <= this.bounds.maxChars) return;
			this.entries.delete(id);
			this.chars -= image.data.length;
		}
	}
}
