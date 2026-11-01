/** Lane A · the session list's keyset cursor (D15), through `cursor.ts`. */

import type { PageCursor, SessionQuery } from "../../../contract";

export interface ListPosition {
	readonly lastModified: number;
	readonly sessionId: string;
}

export function listScope(_query: SessionQuery): string {
	return "";
}

export function listCursor(_scope: string, _after: ListPosition): PageCursor | undefined {
	return undefined;
}

/** Undefined for a cursor this store did not mint: `invalid_input`. */
export function listPosition(_cursor: string, _scope: string): ListPosition | undefined {
	return undefined;
}
