/**
 * `listSessions` and `getSession`: index rows filtered by header cwd, live facts laid over them, newest
 * first by `(updatedAt desc, sessionId desc)`, paged with a keyset cursor.
 */

import {
	type JsonValue,
	type PageRequest,
	type Rejected,
	type SessionGetResult,
	type SessionId,
	type SessionQuery,
	type SessionSummary,
	type SessionsListResult,
	type SessionTitle,
	searchWords,
	sessionMatches,
} from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { parseChildSessionId } from "../ids";
import type { LiveOverlay } from "../ports";
import { rejected } from "../rejections";
import { childRows } from "./children";
import type { ListedRow } from "./listed-row";
import { mapPool } from "./pool";
import type { SessionHead } from "./session-head";
import type { IndexedSession, SessionIndex } from "./session-index";
import type { ToolChildren } from "./tool-children";

/** For rows nobody hosts: no status, no model of its own, no run to cut the transcript at. */
export const NO_LIVE: LiveOverlay = { row: () => undefined };

const SUMMARY_CONCURRENCY = 8;
/** Rows one page of a search reads at most; past them it ends early with a cursor, so a rare word never stalls a request. */
const SEARCH_SCAN_ROWS = 2_000;

/** A row as the contract shows it; `parentId` is the parent session's id when the index found it. */
export function summaryOf(row: IndexedSession, parentId: SessionId | undefined, live: LiveOverlay): SessionSummary {
	const hosted = live.row(row.sessionId);
	const title = titleOf(row);
	const modelId = hosted?.modelId ?? row.modelId;
	return {
		session: { backend: "pi", sessionId: row.sessionId },
		...(title !== undefined && { title }),
		...(row.cwd !== undefined && { cwd: row.cwd }),
		...(row.createdAt !== undefined && { createdAt: row.createdAt }),
		updatedAt: row.updatedAt,
		...(hosted?.runStartedAt !== undefined && { runStartedAt: hosted.runStartedAt }),
		...(parentId !== undefined && { parent: { kind: "fork", session: { backend: "pi", sessionId: parentId } } }),
		...(modelId !== undefined && { modelId }),
		status: hosted?.status ?? "unknown",
		origin: row.origin,
	};
}

function titleOf(row: IndexedSession): SessionTitle | undefined {
	if (row.name !== undefined) return { text: row.name, source: "user" };
	return row.firstPrompt === undefined ? undefined : { text: row.firstPrompt, source: "first_prompt" };
}

/** The summary of a file's session, with its title, origin and fork parent read. */
export async function summaryFor(index: SessionIndex, head: SessionHead, live: LiveOverlay): Promise<SessionSummary> {
	const row = await index.complete(head);
	const parentId = head.parentPath === undefined ? undefined : await index.idOfPath(head.parentPath);
	return summaryOf(row, parentId, live);
}

export async function getSession(
	index: SessionIndex,
	sessionId: SessionId,
	live: LiveOverlay,
): Promise<SessionGetResult> {
	const head = await index.find(sessionId);
	return head === undefined
		? rejected("not_found", `no Pi session ${sessionId}`)
		: { status: "accepted", summary: await summaryFor(index, head, live) };
}

type SessionsPosition = [number, string];

function isSessionsPosition(value: JsonValue): value is SessionsPosition & JsonValue {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "number" &&
		Number.isSafeInteger(value[0]) &&
		value[0] >= 0 &&
		typeof value[1] === "string" &&
		value[1].length > 0
	);
}

export async function listSessions(
	index: SessionIndex,
	query: SessionQuery,
	page: PageRequest,
	live: LiveOverlay,
	toolChildren: ToolChildren,
): Promise<SessionsListResult> {
	const words = searchWords(query.search ?? "");
	const scope = cursorScope(["sessions", query.cwd ?? "", query.parent?.sessionId ?? "", ...words]);
	const after =
		page.cursor === undefined ? undefined : decodeCursor(page.cursor, "sessions", scope, isSessionsPosition);
	if (page.cursor !== undefined && after === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this listing");
	}
	if (query.parent !== undefined && query.parent.backend !== "pi") {
		return { status: "accepted", page: { items: [] } };
	}
	const listed = await rowsOf(index, query, live, toolChildren);
	if ("rejection" in listed) return listed;
	const rows = sortNewestFirst(listed);
	const remaining = after === undefined ? rows : rows.filter((row) => isOlder(row, after));
	if (words.length > 0) return searchPage(remaining, words, page.limit, scope);
	const shown = remaining.slice(0, page.limit);
	const last = shown.at(-1);
	const items = await mapPool(shown, SUMMARY_CONCURRENCY, (row) => row.summary());
	return {
		status: "accepted",
		page: {
			items,
			...(last !== undefined &&
				remaining.length > shown.length && {
					nextCursor: encodeCursor("sessions", scope, [last.updatedAt, last.sessionId]),
				}),
		},
	};
}

/** The next `limit` rows that match, newest first; the cursor stands at the last row read, matched or not. */
async function searchPage(
	remaining: readonly ListedRow[],
	words: readonly string[],
	limit: number,
	scope: string,
): Promise<SessionsListResult> {
	const items: SessionSummary[] = [];
	let read = 0;
	while (read < remaining.length && read < SEARCH_SCAN_ROWS && items.length < limit) {
		const batch = remaining.slice(read, Math.min(remaining.length, read + SUMMARY_CONCURRENCY));
		const summaries = await mapPool(batch, SUMMARY_CONCURRENCY, (row) => row.summary());
		for (const summary of summaries) {
			read += 1;
			if (sessionMatches(words, summary.title?.text, summary.cwd)) items.push(summary);
			if (items.length === limit) break;
		}
	}
	const last = remaining[read - 1];
	return {
		status: "accepted",
		page: {
			items,
			...(last !== undefined &&
				read < remaining.length && {
					nextCursor: encodeCursor("sessions", scope, [last.updatedAt, last.sessionId]),
				}),
		},
	};
}

/** The rows a query lists: the sessions of a directory, or a session's children (its forks, and its tool calls' sub-runs). */
async function rowsOf(
	index: SessionIndex,
	query: SessionQuery,
	live: LiveOverlay,
	toolChildren: ToolChildren,
): Promise<ListedRow[] | Rejected> {
	const heads = await index.scan(query.cwd);
	const row = (head: SessionHead): ListedRow => ({
		updatedAt: head.updatedAt,
		sessionId: head.sessionId,
		summary: () => summaryFor(index, head, live),
	});
	if (query.parent === undefined) return heads.map(row);
	const parentId = query.parent.sessionId;
	if (parseChildSessionId(parentId) !== undefined) return [];
	const forks: ListedRow[] = [];
	for (const head of heads) if (await isForkOf(index, head, parentId)) forks.push(row(head));
	const parent = await getSession(index, parentId, live);
	if (parent.status === "rejected") return forks;
	const children = await childRows({ children: toolChildren, live }, parent.summary);
	return "rejection" in children ? forks : [...forks, ...children];
}

async function isForkOf(index: SessionIndex, head: SessionHead, parentId: SessionId): Promise<boolean> {
	return head.parentPath !== undefined && (await index.idOfPath(head.parentPath)) === parentId;
}

function sortNewestFirst(rows: ListedRow[]): ListedRow[] {
	return rows.sort(
		(a, b) => b.updatedAt - a.updatedAt || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0),
	);
}

function isOlder(row: ListedRow, after: SessionsPosition): boolean {
	return row.updatedAt < after[0] || (row.updatedAt === after[0] && row.sessionId < after[1]);
}
