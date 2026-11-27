/**
 * agy's session list as the contract's. agy 1.5.18 returns every session at once, ignores the `cwd` filter, writes some
 * paths percent-encoded and others realpathed, and reports its own folder for a session that stored no `cwd`; so each
 * row's path is decoded and realpathed here, a row reporting the lister's own (void) folder has an unknown `cwd`, and
 * the filter, the order and the pages are the bridge's.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { cursorScope, decodeCursor, encodeCursor } from "../../../adapter-kit/cursor";
import { phoneName } from "../../../adapter-kit/phone-text";
import { rejected } from "../../../adapter-kit/rejections";
import {
	type JsonValue,
	type PageRequest,
	SessionId,
	type SessionQuery,
	type SessionSummary,
	type SessionsListResult,
	searchWords,
	sessionMatches,
	WorkingDirectory,
} from "../../../contract";
import type { SessionInfo } from "../acp/frames";

export interface ListedSession {
	readonly sessionId: string;
	/** Canonical; absent when agy stored none. */
	readonly cwd?: string;
	readonly title?: string;
	readonly updatedAt: number;
}

/** The rows as the bridge lists them, newest first; `voidDir` is the folder the lister ran in. */
export function listedSessions(rows: readonly SessionInfo[], voidDir: string): ListedSession[] {
	const voidPath = canonicalPath(voidDir);
	const listed = rows.flatMap((row): ListedSession[] => {
		if (!SessionId.safeParse(row.sessionId).success) return [];
		const cwd = row.cwd == null || row.cwd === "" ? undefined : canonicalPath(row.cwd);
		const title = phoneName(row.title ?? "");
		return [
			{
				sessionId: row.sessionId,
				...(cwd !== undefined && cwd !== voidPath && WorkingDirectory.safeParse(cwd).success && { cwd }),
				...(title !== "" && { title }),
				updatedAt: timestampOf(row.updatedAt),
			},
		];
	});
	return listed.sort(
		(a, b) => b.updatedAt - a.updatedAt || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0),
	);
}

/**
 * A path as the file system names it, every symlink resolved (`/var` is `/private/var` on macOS): the percent-decoded
 * path when it exists, else the path as written; a path that no longer exists keeps its decoded spelling.
 */
export function canonicalPath(path: string): string {
	const decoded = percentDecoded(path);
	return realpathOf(decoded) ?? realpathOf(path) ?? resolve(decoded);
}

export function summaryOf(session: ListedSession): SessionSummary {
	return {
		session: { backend: "antigravity", sessionId: session.sessionId },
		...(session.title !== undefined && { title: { text: session.title, source: "generated" } }),
		...(session.cwd !== undefined && { cwd: session.cwd }),
		updatedAt: session.updatedAt,
		status: "unknown",
		origin: "external",
	};
}

type Position = [number, string];

function isPosition(value: JsonValue): value is Position & JsonValue {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === "number" &&
		Number.isSafeInteger(value[0]) &&
		typeof value[1] === "string"
	);
}

/** One page of `sessions` (newest first): the query's directory, or every session when it names none. */
export function sessionsPage(
	sessions: readonly ListedSession[],
	query: SessionQuery,
	page: PageRequest,
): SessionsListResult {
	const cwd = query.cwd === undefined ? undefined : canonicalPath(query.cwd);
	const words = searchWords(query.search ?? "");
	const scope = cursorScope(["sessions", cwd ?? "", query.parent?.sessionId ?? "", ...words]);
	const after = page.cursor === undefined ? undefined : decodeCursor(page.cursor, "sessions", scope, isPosition);
	if (page.cursor !== undefined && after === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this listing");
	}
	if (query.parent !== undefined) return { status: "accepted", page: { items: [] } };
	const remaining = sessions.filter(
		(session) =>
			(cwd === undefined || session.cwd === cwd) &&
			sessionMatches(words, session.title, session.cwd) &&
			(after === undefined || isOlder(session, after)),
	);
	const shown = remaining.slice(0, page.limit);
	const last = shown.at(-1);
	return {
		status: "accepted",
		page: {
			items: shown.map(summaryOf),
			...(last !== undefined &&
				remaining.length > shown.length && {
					nextCursor: encodeCursor("sessions", scope, [last.updatedAt, last.sessionId]),
				}),
		},
	};
}

function isOlder(session: ListedSession, after: Position): boolean {
	return session.updatedAt < after[0] || (session.updatedAt === after[0] && session.sessionId < after[1]);
}

function percentDecoded(path: string): string {
	if (!path.includes("%")) return path;
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

function realpathOf(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

/** agy's ISO time; a row without one sorts last. */
function timestampOf(iso: string | null | undefined): number {
	const at = iso == null ? Number.NaN : Date.parse(iso);
	return Number.isFinite(at) ? Math.max(0, at) : 0;
}
