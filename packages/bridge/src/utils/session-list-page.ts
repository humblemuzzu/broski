/**
 * Shared contract for paged session lists: `pi_sessions`, `cc_sessions`, `cx_threads`, OpenCode's
 * `sessions` and `unified_sessions`.
 *
 * A page holds the newest rows that sort after a cursor, and the cursor names the last row of the
 * previous page rather than a distance from the top, so a session created between two pages can
 * neither duplicate nor skip a row. No `limit` and no `before` answers the whole list with no
 * `hasMore`/`nextCursor`, which is what a client that sent neither saw before.
 */

import { pagedLimit } from "../types/transcript-page";

export const DEFAULT_SESSION_PAGE_LIMIT = 100;
export const MAX_SESSION_PAGE_LIMIT = 500;

export type SessionListPage<T> = {
	items: T[];
	hasMore: boolean;
	nextCursor?: string;
};

/** What a row is ordered and resumed by: newest modified first, `id` breaking ties. */
export type SessionListRow = { id: string; modified: number };

export type SessionPageRequest = { limit?: number; before?: string };

export function sessionPageLimit(value: unknown): number | undefined {
	return pagedLimit(value, MAX_SESSION_PAGE_LIMIT);
}

export function sessionPageRequest(message: { limit?: unknown; before?: unknown }): SessionPageRequest {
	const limit = sessionPageLimit(message.limit);
	const before = typeof message.before === "string" && message.before.trim() !== "" ? message.before : undefined;
	return { ...(limit !== undefined ? { limit } : {}), ...(before !== undefined ? { before } : {}) };
}

export const isPagedSessionRequest = (request: SessionPageRequest): boolean =>
	request.limit !== undefined || request.before !== undefined;

export function encodeSessionPageCursor(row: SessionListRow): string {
	return Buffer.from(JSON.stringify([row.modified, row.id]), "utf8").toString("base64url");
}

/** Undefined for a cursor this bridge did not mint, which then answers the newest page. */
export function decodeSessionPageCursor(cursor: string): SessionListRow | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
	const [modified, id] = parsed;
	if (typeof modified !== "number" || !Number.isFinite(modified)) return undefined;
	if (typeof id !== "string" || id === "") return undefined;
	return { id, modified };
}

export function sessionPageFields(page: SessionListPage<unknown> | null): { hasMore?: boolean; nextCursor?: string } {
	if (!page) return {};
	return page.nextCursor ? { hasMore: page.hasMore, nextCursor: page.nextCursor } : { hasMore: page.hasMore };
}

/** Negative when `a` is listed above `b`, positive when below: newest first, `id` descending. */
function compareRows(a: SessionListRow, b: SessionListRow): number {
	if (a.modified !== b.modified) return a.modified > b.modified ? -1 : 1;
	if (a.id === b.id) return 0;
	return a.id > b.id ? -1 : 1;
}

export function sortSessionRows<T>(items: readonly T[], rowOf: (item: T) => SessionListRow): T[] {
	return [...items].sort((a, b) => compareRows(rowOf(a), rowOf(b)));
}

export function pageSessionList<T>(
	items: readonly T[],
	request: SessionPageRequest,
	rowOf: (item: T) => SessionListRow,
): SessionListPage<T> {
	if (!isPagedSessionRequest(request)) return { items: sortSessionRows(items, rowOf), hasMore: false };

	const limit = request.limit ?? DEFAULT_SESSION_PAGE_LIMIT;
	const sorted = sortSessionRows(items, rowOf);
	const boundary = request.before === undefined ? undefined : decodeSessionPageCursor(request.before);
	const start = boundary === undefined ? 0 : sorted.findIndex((item) => compareRows(rowOf(item), boundary) > 0);
	if (start < 0) return { items: [], hasMore: false };

	const end = Math.min(start + limit, sorted.length);
	const page = sorted.slice(start, end);
	const last = page[page.length - 1];
	const hasMore = end < sorted.length;
	return {
		items: page,
		hasMore,
		...(hasMore && last !== undefined ? { nextCursor: encodeSessionPageCursor(rowOf(last)) } : {}),
	};
}
