import type { ServerMessage } from "../contract";
import { encodeFrame } from "./frame";

/**
 * The answer to a paged read, read again with a smaller page while it is larger than the link
 * carries. A shorter page is still a page: only an absent `nextCursor` ends a list (README §11.1),
 * and the adapter mints the cursor for the page it actually returned.
 */
export async function pageWithinFrame<M extends ServerMessage>(
	maxFrameBytes: number,
	limit: number,
	read: (limit: number) => Promise<M>,
): Promise<M> {
	let current = limit;
	for (;;) {
		const message = await read(current);
		const bytes = encodeFrame(message).bytes;
		if (bytes <= maxFrameBytes || current === 1) return message;
		current = Math.max(1, Math.min(current - 1, Math.floor((current * maxFrameBytes) / bytes)));
	}
}
