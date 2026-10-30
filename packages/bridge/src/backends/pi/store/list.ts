/**
 * `listSessions` and `getSession`: index rows filtered by header cwd, live facts laid over them, newest
 * first by `(updatedAt desc, sessionId desc)`, paged with a keyset cursor (D7).
 */

import type {
	JsonValue,
	PageRequest,
	SessionGetResult,
	SessionId,
	SessionQuery,
	SessionSummary,
	SessionsListResult,
	SessionTitle,
} from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import type { LiveOverlay } from "../ports";
import { rejected } from "../rejections";
import { mapPool } from "./pool";
import type { SessionHead } from "./session-head";
import type { IndexedSession, SessionIndex } from "./session-index";

/** For rows nobody hosts: no status, no model of its own, no run to cut the transcript at. */
export const NO_LIVE: LiveOverlay = { row: () => undefined };

const SUMMARY_CONCURRENCY = 8;

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
		...(parentId !== undefined && { parent: { kind: "fork", session: { backend: "pi", sessionId: parentId } } }),
		archived: false,
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
): Promise<SessionsListResult> {
	const scope = cursorScope(["sessions", query.cwd ?? "", String(query.archived), query.parent?.sessionId ?? ""]);
	const after =
		page.cursor === undefined ? undefined : decodeCursor(page.cursor, "sessions", scope, isSessionsPosition);
	if (page.cursor !== undefined && after === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this listing");
	}
	if (query.archived || (query.parent !== undefined && query.parent.backend !== "pi")) {
		return { status: "accepted", page: { items: [] } };
	}
	const heads = sortNewestFirst(await headsOf(index, query));
	const remaining = after === undefined ? heads : heads.filter((head) => isOlder(head, after));
	const shown = remaining.slice(0, page.limit);
	const last = shown.at(-1);
	const items = await mapPool(shown, SUMMARY_CONCURRENCY, (head) => summaryFor(index, head, live));
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

async function headsOf(index: SessionIndex, query: SessionQuery): Promise<SessionHead[]> {
	const heads = await index.scan(query.cwd);
	if (query.parent === undefined) return heads;
	const parentId = query.parent.sessionId;
	const forks: SessionHead[] = [];
	for (const head of heads) if (await isForkOf(index, head, parentId)) forks.push(head);
	return forks;
}

async function isForkOf(index: SessionIndex, head: SessionHead, parentId: SessionId): Promise<boolean> {
	return head.parentPath !== undefined && (await index.idOfPath(head.parentPath)) === parentId;
}

function sortNewestFirst(heads: SessionHead[]): SessionHead[] {
	return heads.sort(
		(a, b) => b.updatedAt - a.updatedAt || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0),
	);
}

function isOlder(head: SessionHead, after: SessionsPosition): boolean {
	return head.updatedAt < after[0] || (head.updatedAt === after[0] && head.sessionId < after[1]);
}
