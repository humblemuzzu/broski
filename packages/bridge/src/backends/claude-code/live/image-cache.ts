import type { AttachmentId, ImageContent, SessionId } from "../../../contract";

const MAX_IMAGES = 32;
const MAX_TOTAL_CHARS = 32 * 1_048_576;

export interface CachedImage {
	readonly mimeType: string;
	readonly data: string;
	readonly name?: string;
}

export class LiveImageCache {
	private readonly entries = new Map<string, CachedImage>();
	private totalChars = 0;

	put(sessionId: SessionId, attachmentId: AttachmentId, image: CachedImage): void {
		if (image.data.length === 0 || image.data.length > MAX_TOTAL_CHARS) return;
		const key = `${sessionId}\0${attachmentId}`;
		const existing = this.entries.get(key);
		if (existing !== undefined) {
			this.totalChars -= existing.data.length;
			this.entries.delete(key);
		}
		this.entries.set(key, image);
		this.totalChars += image.data.length;
		for (const [oldKey, oldEntry] of this.entries) {
			if (this.entries.size <= MAX_IMAGES && this.totalChars <= MAX_TOTAL_CHARS) break;
			this.entries.delete(oldKey);
			this.totalChars -= oldEntry.data.length;
		}
	}

	get(sessionId: SessionId, attachmentId: AttachmentId): ImageContent | undefined {
		const key = `${sessionId}\0${attachmentId}`;
		const hit = this.entries.get(key);
		if (hit === undefined) return undefined;
		this.entries.delete(key);
		this.entries.set(key, hit);
		return {
			kind: "image",
			mimeType: hit.mimeType,
			data: hit.data,
			...(hit.name !== undefined && { name: hit.name }),
		};
	}
}
