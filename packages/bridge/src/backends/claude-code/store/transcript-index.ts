/** Per-session `{size, mtimeMs, count}` and the chain's skeleton, so a newest-first page is one SDK read (D26). */

import type { SessionId } from "../../../contract";
import type { RawFacts } from "./raw-scan";

export type EntryType = "user" | "assistant" | "system";

export interface IndexEntry {
	/** The file's `size` and `mtimeMs` when the chain was read: the index is good while both still hold. */
	readonly size: number;
	readonly mtimeMs: number;
	readonly count: number;
	/** The chain, oldest first: the uuid and type of each entry. */
	readonly uuids: readonly string[];
	readonly types: readonly EntryType[];
	readonly positions: ReadonlyMap<string, number>;
	/** The API message each assistant entry belongs to, and how many blocks of it come before this entry (`blockId`). */
	readonly messageIds: readonly (string | undefined)[];
	readonly blockBase: readonly number[];
	readonly blockCounts: readonly number[];
	/** `tool_use` id → the assistant entry that made the call, and the user entry that answered it. */
	readonly toolCalls: ReadonlyMap<string, number>;
	readonly toolResults: ReadonlyMap<string, number>;
	readonly toolNames: ReadonlyMap<string, string>;
	/**
	 * What the raw file adds to entries of the chain, by uuid (D26): the `toolUseResult` spans and the `system` facts.
	 */
	readonly raw: RawFacts;
}

const MAX_SESSIONS = 8;

export class TranscriptIndex {
	private readonly entries = new Map<SessionId, IndexEntry>();

	get(sessionId: SessionId, size: number, mtimeMs: number): IndexEntry | undefined {
		const entry = this.entries.get(sessionId);
		if (entry === undefined || entry.size !== size || entry.mtimeMs !== mtimeMs) return undefined;
		this.entries.delete(sessionId);
		this.entries.set(sessionId, entry);
		return entry;
	}

	set(sessionId: SessionId, entry: IndexEntry): void {
		this.entries.delete(sessionId);
		this.entries.set(sessionId, entry);
		if (this.entries.size > MAX_SESSIONS) this.entries.delete(this.entries.keys().next().value ?? sessionId);
	}

	/** The session's index and those of its subagents (`<sessionId>/<agentId>`). */
	drop(sessionId: SessionId): void {
		for (const key of [...this.entries.keys()]) {
			if (key === sessionId || key.startsWith(`${sessionId}/`)) this.entries.delete(key);
		}
	}

	clear(): void {
		this.entries.clear();
	}
}
