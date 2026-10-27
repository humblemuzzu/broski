/**
 * Shared contract for paged transcript reads: `pi_session_messages`, `cc_session_messages`,
 * `cx_thread_messages` and OpenCode's `session_messages`.
 *
 * A page holds the newest messages that end at a cursor, and `nextCursor` names the boundary the
 * next, older page ends at — paging always walks backwards from the tail. The cursor is opaque to
 * the app and names a place in the file, not a distance from the tail, so it stays valid when the
 * session grows at the end.
 *
 * A reader that cannot build a correct page returns `null`; the handler then answers with the whole
 * transcript and no `hasMore`/`nextCursor`, exactly what an app that sends no limit saw before.
 */

export type TranscriptPage<T> = {
	messages: T[];
	hasMore: boolean;
	nextCursor?: string;
	/** The cursor named no message of this session: `messages` is the newest page, not the one before it. */
	cursorUnknown?: boolean;
};

export const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 80;
export const MAX_TRANSCRIPT_PAGE_LIMIT = 500;

export function transcriptPageLimit(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.max(1, Math.min(Math.floor(value), MAX_TRANSCRIPT_PAGE_LIMIT));
}

export function transcriptCursor(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = value.trim();
	return text.length > 0 ? text : undefined;
}

export function transcriptPageFields(
	page: {
		hasMore: boolean;
		nextCursor?: string;
		cursorUnknown?: boolean;
	} | null,
): {
	hasMore?: boolean;
	nextCursor?: string;
	cursorUnknown?: boolean;
} {
	if (!page) return {};
	const fields: { hasMore: boolean; nextCursor?: string; cursorUnknown?: boolean } = { hasMore: page.hasMore };
	if (page.nextCursor) fields.nextCursor = page.nextCursor;
	if (page.cursorUnknown) fields.cursorUnknown = true;
	return fields;
}
