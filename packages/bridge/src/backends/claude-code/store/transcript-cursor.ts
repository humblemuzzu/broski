/** Lane A · the transcript cursor: the entry the next page resumes at and how many of its items remain (D15). */

import type { JsonValue, PageCursor, SessionId } from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { isRecord } from "../json";

/** Resume at the entry `uuid`; with `items`, only its first `items` items remain, else all of them do. */
export interface TranscriptPosition {
	readonly uuid: string;
	readonly items?: number;
}

interface Wire {
	u: string;
	k?: number;
}

export function transcriptScope(sessionId: SessionId): string {
	return cursorScope(["transcript", sessionId]);
}

export function transcriptCursor(scope: string, position: TranscriptPosition): PageCursor {
	const wire: Record<string, JsonValue> = {
		u: position.uuid,
		...(position.items !== undefined && { k: position.items }),
	};
	return encodeCursor("transcript", scope, wire);
}

/** Undefined for a cursor this store did not mint: `invalid_input`. */
export function transcriptPosition(cursor: string, scope: string): TranscriptPosition | undefined {
	const wire = decodeCursor<Wire>(cursor, "transcript", scope, isWire);
	return wire === undefined ? undefined : { uuid: wire.u, ...(wire.k !== undefined && { items: wire.k }) };
}

function isWire(position: JsonValue): position is Wire & JsonValue {
	if (!isRecord(position)) return false;
	const { u, k } = position;
	const countOk = k === undefined || (typeof k === "number" && Number.isSafeInteger(k) && k > 0);
	return typeof u === "string" && u.length > 0 && u.length <= 256 && countOk;
}
