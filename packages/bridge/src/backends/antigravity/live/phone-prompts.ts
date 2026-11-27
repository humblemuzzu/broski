/**
 * The prompts the phone sends, as agy's `session/load` replay lacks them: it keeps no image and no `clientRequestId`
 * (agy 1.5.18). Each prompt's images are kept in the kit's image cache under an id that names the session
 * (`<sessionId>/<uuid>`), for `readAttachment`, and a replayed user message that is a prompt this bridge sent gets its
 * `clientRequestId` back, and its images while they are kept. Prompts sent elsewhere, or before the bridge started,
 * have neither.
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
	readonly clientRequestId: string;
	readonly images: readonly ImageRef[];
}

export interface PromptImage {
	readonly type: "image";
	readonly mimeType: string;
	readonly data: string;
}

export class PhonePrompts {
	private readonly cache = new ImageCache();
	/** Each session's prompts as this bridge sent them, oldest first. */
	private readonly sent = new Map<string, Sent[]>();

	constructor(private readonly fitImage: ImageFitter) {}

	/**
	 * Keeps the prompt, `text` as the transcript shows it, returning how events name its images and how `session/prompt`
	 * carries them.
	 */
	take(sessionId: string, input: PromptInput, text: string): { refs: ImageRef[]; blocks: PromptImage[] } {
		const refs: ImageRef[] = [];
		const blocks: PromptImage[] = [];
		for (const attachment of input.attachments) {
			if (attachment.kind !== "image") continue;
			refs.push(this.cache.put(`${sessionId}/${crypto.randomUUID()}`, attachment));
			blocks.push({ type: "image", mimeType: attachment.mimeType, data: attachment.data });
		}
		this.remember(sessionId, { text, clientRequestId: input.clientRequestId, images: refs });
		return { refs, blocks };
	}

	read(sessionId: string, attachmentId: string, variant: ImageVariant): Promise<AttachmentReadResult> {
		const image = attachmentId.startsWith(`${sessionId}/`) ? this.cache.get(attachmentId) : undefined;
		if (image === undefined) return Promise.resolve(rejected("not_found", `no Antigravity image ${attachmentId}`));
		return imageRead(image, variant, this.fitImage, image.name);
	}

	/**
	 * `items` with what the replay lost of the user messages this bridge sent, paired in order from the end by their
	 * text. Either side may hold messages the other lacks: the replay a `/compact` or a terminal's turn, the prompts this
	 * bridge sent one agy kept none of; so a message pairs with the newest prompt of its text not yet paired, and one
	 * that has none is left as it is. `underWay`: the newest prompt is the run under way, which `items` does not hold.
	 */
	restored(sessionId: string, items: readonly TranscriptItem[], underWay: boolean): readonly TranscriptItem[] {
		const sent = this.sent.get(sessionId);
		if (sent === undefined) return items;
		const restored = [...items];
		let unpaired = underWay ? sent.length - 1 : sent.length;
		for (let index = restored.length - 1; index >= 0 && unpaired > 0; index -= 1) {
			const item = restored[index];
			if (item?.kind !== "user_message") continue;
			const match = sent.slice(0, unpaired).findLastIndex((prompt) => prompt.text === item.text);
			const prompt = sent[match];
			if (prompt === undefined) continue;
			unpaired = match;
			restored[index] = this.restoredItem(item, prompt);
		}
		return restored;
	}

	private restoredItem(item: UserMessageItem, prompt: Sent): UserMessageItem {
		const kept = prompt.images.filter((image) => this.cache.get(image.id) !== undefined);
		return { ...item, attachments: [...item.attachments, ...kept], clientRequestId: prompt.clientRequestId };
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
