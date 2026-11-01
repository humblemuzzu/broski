/** Lane A · per-session `{size, mtimeMs, count}`, so a newest-first page is one SDK `offset`/`limit` read (D15). */

import type { SessionId } from "../../../contract";

export interface IndexEntry {
	readonly size: number;
	readonly mtimeMs: number;
	readonly count: number;
}

export class TranscriptIndex {
	get(_sessionId: SessionId, _size: number, _mtimeMs: number): IndexEntry | undefined {
		return undefined;
	}

	set(_sessionId: SessionId, _entry: IndexEntry): void {}

	drop(_sessionId: SessionId): void {}
}
