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
	type SessionOrigin,
	type SessionQuery,
	type SessionSummary,
	type SessionsListResult,
	type SessionTitle,
	searchWords,
	sessionMatches,
	WorkingDirectory,
} from "../../../contract";
import type { SessionInfo } from "../acp/frames";
import type { MadeSession } from "./made";

export interface ListedSession {
	readonly sessionId: string;
	/** Canonical; absent when agy stored none. */
	readonly cwd?: string;
	readonly title?: string;
	readonly updatedAt: number;
	/** agy has not stored the session, which the bridge made (`made.ts`): what the bridge kept of it. */
	readonly unstored?: { readonly firstPrompt?: string };
}

/** agy's rows as the bridge lists them; `voidDir` is the folder the lister ran in. */
export function listedSessions(rows: readonly SessionInfo[], voidDir: string): ListedSession[] {
	const voidPath = canonicalPath(voidDir);
	return rows.flatMap((row): ListedSession[] => {
		if (!SessionId.safeParse(row.sessionId).success) return [];
		const cwd = row.cwd === undefined || row.cwd === "" ? undefined : canonicalPath(row.cwd);
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
}

/** A session the bridge made that agy has not stored, as the bridge keeps it (`made.ts`). */
export function unstoredRow(sessionId: string, made: MadeSession): ListedSession {
	return {
		sessionId,
		cwd: canonicalPath(made.options.cwd),
		updatedAt: made.at,
		unstored: made.firstPrompt === undefined ? {} : { firstPrompt: made.firstPrompt },
	};
}

/**
 * A path as the file system names it, every symlink resolved (`/var` is `/private/var` on macOS): the percent-decoded
 * path when it exists, else the path as written; a path that no longer exists keeps its decoded spelling.
 */
export function canonicalPath(path: string): string {
	const decoded = percentDecoded(path);
	return realpathOf(decoded) ?? realpathOf(path) ?? resolve(decoded);
}

/**
 * A session agy has not stored is idle (no client can be running what agy does not have) and titled by the person's
 * first prompt, if they sent one; agy's own sessions may be running in a terminal.
 */
export function summaryOf(session: ListedSession, origin: SessionOrigin): SessionSummary {
	const title = titleOf(session);
	return {
		session: { backend: "antigravity", sessionId: session.sessionId },
		...(title !== undefined && { title }),
		...(session.cwd !== undefined && { cwd: session.cwd }),
		updatedAt: session.updatedAt,
		status: session.unstored === undefined ? "unknown" : "idle",
		origin,
	};
}

export function titleOf({ title, unstored }: ListedSession): SessionTitle | undefined {
	return title !== undefined ? { text: title, source: "generated" } : firstPromptTitle(unstored?.firstPrompt);
}

/** A session agy has not titled stands under the person's first prompt in it. */
export function firstPromptTitle(prompt: string | undefined): SessionTitle | undefined {
	const text = phoneName(prompt ?? "");
	return text === "" ? undefined : { text, source: "first_prompt" };
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

/** One page of `rows`, newest first: the query's directory, or every session when it names none. */
export function sessionsPage(
	rows: readonly SessionSummary[],
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
	const remaining = rows
		.filter(
			(row) =>
				(cwd === undefined || row.cwd === cwd) &&
				sessionMatches(words, row.title?.text, row.cwd) &&
				(after === undefined || isOlder(row, after)),
		)
		.sort(newestFirst);
	const shown = remaining.slice(0, page.limit);
	const last = shown.at(-1);
	return {
		status: "accepted",
		page: {
			items: shown,
			...(last !== undefined &&
				remaining.length > shown.length && {
					nextCursor: encodeCursor("sessions", scope, [last.updatedAt, last.session.sessionId]),
				}),
		},
	};
}

function newestFirst(a: SessionSummary, b: SessionSummary): number {
	const [aId, bId] = [a.session.sessionId, b.session.sessionId];
	return b.updatedAt - a.updatedAt || (aId < bId ? 1 : aId > bId ? -1 : 0);
}

function isOlder(row: SessionSummary, after: Position): boolean {
	const { sessionId } = row.session;
	return row.updatedAt < after[0] || (row.updatedAt === after[0] && sessionId < after[1]);
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
function timestampOf(iso: string | undefined): number {
	const at = iso === undefined ? Number.NaN : Date.parse(iso);
	return Number.isFinite(at) ? Math.max(0, at) : 0;
}
