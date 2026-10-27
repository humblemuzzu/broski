import type { SessionMessagesResponse } from "@opencode-ai/sdk/v2";
import type { TranscriptPage } from "../../types/transcript-page";
import { fitTranscriptPage } from "../../utils/transcript-page-fit";
import { cutAtTurnStart } from "../../utils/turn-aligned-page";

export type OcSessionMessage = SessionMessagesResponse[number];

/**
 * A window of the fetched transcript, walked backwards from `before`, for the shared contract in
 * `types/transcript-page.ts`. Paging stays here rather than going to the OpenCode server's own
 * `limit`/`before`: a server that ignored either would answer the whole transcript — the reply this
 * window exists to keep small — or a page whose boundary the app could not name.
 *
 * A cursor that names no message of this session (rewound, compacted, another session) yields the
 * newest page and says so, so the app replaces its transcript instead of asking again.
 */
export function pageSessionMessages(
	messages: OcSessionMessage[],
	options: { limit: number; before?: string },
): TranscriptPage<OcSessionMessage> {
	const end = options.before === undefined ? messages.length : indexOfMessage(messages, options.before);
	const unknown = end === null;
	const at = end ?? messages.length;
	const cut = cutAtTurnStart(messages, Math.max(0, at - options.limit), {
		isUser: (message) => message.info.role === "user",
	});

	const fitted = fitTranscriptPage(messages.slice(cut.start, at));
	const start = cut.start + fitted.dropped;
	const first = fitted.messages[0];
	const fields = start > 0 && first ? { hasMore: true, nextCursor: first.info.id } : { hasMore: false };
	return unknown
		? { messages: fitted.messages, ...fields, cursorUnknown: true }
		: { messages: fitted.messages, ...fields };
}

function indexOfMessage(messages: OcSessionMessage[], id: string): number | null {
	const index = messages.findIndex((message) => message.info.id === id);
	return index === -1 ? null : index;
}
