/** The session list's keyset cursor (D23), through `cursor.ts`. */

import { type JsonValue, type PageCursor, type SessionQuery, searchWords } from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { isRecord } from "../json";
import type { Position } from "./enumerate";

export type ListPosition = Position;

interface Wire {
	t: number;
	i: string;
}

export function listScope(query: SessionQuery): string {
	return cursorScope(["sessions", query.cwd ?? "", query.parent?.sessionId ?? "", ...searchWords(query.search ?? "")]);
}

export function listCursor(scope: string, after: ListPosition): PageCursor {
	return encodeCursor("sessions", scope, {
		t: after.at,
		i: after.sessionId,
	});
}

/** Undefined for a cursor this store did not mint: `invalid_input`. */
export function listPosition(cursor: string, scope: string): ListPosition | undefined {
	const wire = decodeCursor<Wire>(cursor, "sessions", scope, isWire);
	return wire === undefined ? undefined : { at: wire.t, sessionId: wire.i };
}

function isWire(position: JsonValue): position is Wire & JsonValue {
	if (!isRecord(position)) return false;
	const { t, i } = position;
	return typeof t === "number" && Number.isSafeInteger(t) && t >= 0 && typeof i === "string" && i.length > 0;
}
