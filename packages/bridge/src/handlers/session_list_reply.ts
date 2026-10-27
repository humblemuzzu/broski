import {
	isPagedSessionRequest,
	pageSessionList,
	type SessionListRow,
	sessionPageFields,
	sessionPageRequest,
} from "../utils/session-list-page";

export type SessionListReply<T> = { data: T[]; hasMore?: boolean; nextCursor?: string };

/**
 * The `data` of a list reply, plus `hasMore`/`nextCursor` when the request asked for a page. A
 * request that names neither keeps the whole list it always got.
 */
export function sessionListReply<T>(
	items: readonly T[],
	message: { limit?: unknown; before?: unknown },
	rowOf: (item: T) => SessionListRow,
): SessionListReply<T> {
	const request = sessionPageRequest(message);
	if (!isPagedSessionRequest(request)) return { data: [...items] };
	const page = pageSessionList(items, request, rowOf);
	return { data: page.items, ...sessionPageFields(page) };
}
