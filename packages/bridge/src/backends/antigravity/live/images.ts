/**
 * The images the phone sends with its prompts. agy's `session/load` replays no image (agy 1.5.18), so the bytes are
 * kept here, in the kit's image cache, under an id that names the session (`<sessionId>/<uuid>`), for `readAttachment`
 * and for the transcript: a replayed user message that is one this bridge sent names its images again while they are
 * kept. Images of turns sent elsewhere, or before the bridge started, cannot be shown.
 */

import { ImageCache } from "../../../adapter-kit/image-cache";
import { imageRead } from "../../../adapter-kit/image-read";
import type { ImageFitter } from "../../../adapter-kit/ports";
import { rejected } from "../../../adapter-kit/rejections";
import type {
	AttachmentReadResult,
	ImageRef,
	ImageVariant,
	PromptInput,
	TranscriptItem,
	UserMessageItem,
} from "../../../contract";

const SENT_PER_SESSION = 64;
const SESSIONS_KEPT = 32;

interface Sent {
	readonly text: string;
	readonly images: readonly ImageRef[];
}

export interface PromptImage {
	readonly type: "image";
	readonly mimeType: string;
	readonly data: string;
}

export class PhoneImages {
	private readonly cache = new ImageCache();
	/** Each session's prompts as this bridge sent them, oldest first. */
	private readonly sent = new Map<string, Sent[]>();

	constructor(private readonly fitImage: ImageFitter) {}

	/** Keeps the prompt's images, returning how events name them and how `session/prompt` carries them. */
	take(sessionId: string, input: PromptInput, text: string): { refs: ImageRef[]; blocks: PromptImage[] } {
		const refs: ImageRef[] = [];
		const blocks: PromptImage[] = [];
		for (const attachment of input.attachments) {
			if (attachment.kind !== "image") continue;
			refs.push(this.cache.put(`${sessionId}/${crypto.randomUUID()}`, attachment));
			blocks.push({ type: "image", mimeType: attachment.mimeType, data: attachment.data });
		}
		this.remember(sessionId, { text, images: refs });
		return { refs, blocks };
	}

	read(sessionId: string, attachmentId: string, variant: ImageVariant): Promise<AttachmentReadResult> {
		const image = attachmentId.startsWith(`${sessionId}/`) ? this.cache.get(attachmentId) : undefined;
		if (image === undefined) return Promise.resolve(rejected("not_found", `no Antigravity image ${attachmentId}`));
		return imageRead(image, variant, this.fitImage, image.name);
	}

	/**
	 * `items` with the images of the user messages this bridge sent: the replay's newest user messages are the newest it
	 * sent, so they are paired from the end, and a pair whose text differs is not one.
	 */
	named(sessionId: string, items: readonly TranscriptItem[]): readonly TranscriptItem[] {
		const sent = this.sent.get(sessionId);
		if (sent === undefined || !sent.some((prompt) => prompt.images.length > 0)) return items;
		const named = [...items];
		let next = sent.length - 1;
		for (let index = named.length - 1; index >= 0 && next >= 0; index -= 1) {
			const item = named[index];
			if (item?.kind !== "user_message") continue;
			const prompt = sent[next];
			next -= 1;
			if (prompt === undefined || prompt.text !== item.text) continue;
			named[index] = this.withImages(item, prompt);
		}
		return named;
	}

	private withImages(item: UserMessageItem, prompt: Sent): UserMessageItem {
		const kept = prompt.images.filter((image) => this.cache.get(image.id) !== undefined);
		return kept.length === 0 ? item : { ...item, attachments: [...item.attachments, ...kept] };
	}

	private remember(sessionId: string, prompt: Sent): void {
		const prompts = this.sent.get(sessionId) ?? [];
		this.sent.delete(sessionId);
		this.sent.set(sessionId, [...prompts, prompt].slice(-SENT_PER_SESSION));
		for (const oldest of this.sent.keys()) {
			if (this.sent.size <= SESSIONS_KEPT) break;
			this.sent.delete(oldest);
		}
	}
}
