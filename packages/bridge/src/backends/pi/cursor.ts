/**
 * The envelope of every page cursor this adapter mints: versioned, bound to the read it pages, and
 * refused whole when anything about it is not what this adapter wrote (contract README §11.1).
 */

import { createHash } from "node:crypto";
import { type JsonValue, PageCursor } from "../../contract";

const VERSION = 1;

export type CursorKind = "sessions" | "transcript" | "tree";

/** Checks that a decoded position has the shape the reader wrote; anything else is a foreign cursor. */
export type PositionGuard<T> = (position: JsonValue) => position is T & JsonValue;

/**
 * The digest of what a read pages over (a listing's query, a transcript's session), so a cursor
 * from another read is refused instead of paging the wrong list.
 */
export function cursorScope(parts: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("base64url");
}

export function encodeCursor(kind: CursorKind, scope: string, position: JsonValue): PageCursor {
	const cursor = Buffer.from(JSON.stringify({ v: VERSION, k: kind, s: scope, p: position })).toString("base64url");
	if (!PageCursor.safeParse(cursor).success) throw new Error(`a ${kind} cursor outgrew the contract's bound`);
	return cursor;
}

/** The position `cursor` holds, or undefined when this adapter did not mint it for this kind and scope. */
export function decodeCursor<T>(
	cursor: string,
	kind: CursorKind,
	scope: string,
	guard: PositionGuard<T>,
): (T & JsonValue) | undefined {
	if (!PageCursor.safeParse(cursor).success || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
	const envelope = parseJson(Buffer.from(cursor, "base64url").toString("utf8"));
	if (!isRecord(envelope)) return undefined;
	const { v, k, s, p } = envelope;
	if (v !== VERSION || k !== kind || s !== scope || p === undefined) return undefined;
	return guard(p) ? p : undefined;
}

function parseJson(text: string): JsonValue | undefined {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
