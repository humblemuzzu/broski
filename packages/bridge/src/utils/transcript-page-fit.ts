/**
 * A transcript page has to survive the link: one reply that does not fit is a page the phone never
 * receives, so a page is measured in bytes before it is answered, not in messages alone.
 *
 * The newest messages are the ones kept — the page ends where the caller's cursor already points —
 * and any message that is larger than a whole page on its own is cut down to fit rather than
 * dropped, with the cut visible in the text.
 */

import { cutLargestString } from "./json-string-slots";

/** A page leaves a quarter of the 8 MiB link frame for the reply's envelope and its ids. */
export const TRANSCRIPT_PAGE_MAX_BYTES = 6 * 1024 * 1024;

const MAX_TRUNCATION_PASSES = 6;
const MARKER_RESERVE = 64;

export type FittedPage<Message> = {
	/** The newest messages that fit, oldest first. */
	messages: Message[];
	/** How many of the front of the candidate page were left out, so the caller can move its cursor. */
	dropped: number;
};

export function messageBytes(message: unknown): number {
	return Buffer.byteLength(JSON.stringify(message) ?? "");
}

export type FitOptions<Message> = {
	budget?: number;
	/** Whether a message may be the page's first; false for one that renders as part of the message before it. */
	canOpen?: (message: Message) => boolean;
};

function shrinkMessage<Message>(message: Message, budget: number): Message {
	const copy = { ...message } as Record<string, unknown>;
	let bytes = messageBytes(copy);
	for (let pass = 0; pass < MAX_TRUNCATION_PASSES && bytes > budget; pass++) {
		if (!cutLargestString(copy, bytes - budget + MARKER_RESERVE)) break;
		bytes = messageBytes(copy);
	}
	return copy as unknown as Message;
}

export function fitTranscriptPage<Message>(
	messages: readonly Message[],
	options: FitOptions<Message> = {},
): FittedPage<Message> {
	const budget = options.budget ?? TRANSCRIPT_PAGE_MAX_BYTES;
	const kept: Message[] = [];
	let bytes = 0;
	for (let index = messages.length - 1; index >= 0; index--) {
		let message = messages[index] as Message;
		let size = messageBytes(message);
		if (size > budget) {
			if (kept.length > 0) break;
			message = shrinkMessage(message, budget);
			size = messageBytes(message);
		}
		if (kept.length > 0 && bytes + size > budget) break;
		kept.push(message);
		bytes += size;
	}
	kept.reverse();

	const canOpen = options.canOpen;
	let dropped = messages.length - kept.length;
	while (canOpen && kept.length > 1 && !canOpen(kept[0] as Message)) {
		kept.shift();
		dropped++;
	}
	return { messages: kept, dropped };
}
