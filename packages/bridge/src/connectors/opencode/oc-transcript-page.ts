import type { SessionMessagesResponse } from "@opencode-ai/sdk/v2";
import type { TranscriptPage } from "../../types/transcript-page";

export type OcSessionMessage = SessionMessagesResponse[number];

/**
 * A window of the fetched transcript, walked backwards from `before`, for the shared contract in
 * `types/transcript-page.ts`. Paging stays here rather than going to the OpenCode server's own
 * `limit`/`before`: a server that ignored either would answer the whole transcript — the reply this
 * window exists to keep small — or a page whose boundary the app could not name.
 */
export function pageSessionMessages(
	messages: OcSessionMessage[],
	options: { limit: number; before?: string },
): TranscriptPage<OcSessionMessage> | null {
	const end = options.before === undefined ? messages.length : indexOfMessage(messages, options.before);
	if (end === null) return null;
	const start = Math.max(0, end - options.limit);
	const page = messages.slice(start, end);
	const first = page[0];
	if (!first) return null;
	const hasMore = start > 0;
	return hasMore ? { messages: page, hasMore, nextCursor: first.info.id } : { messages: page, hasMore };
}

function indexOfMessage(messages: OcSessionMessage[], id: string): number | null {
	const index = messages.findIndex((message) => message.info.id === id);
	return index === -1 ? null : index;
}
