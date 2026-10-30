import {
	CURRENT_SESSION_VERSION,
	type FileEntry,
	migrateSessionEntries,
	type SessionEntry,
	type SessionHeader,
} from "@earendil-works/pi-coding-agent";

/** Compile-time exhaustive: a new entry type in the SDK fails here instead of being skipped unseen. */
const ENTRY_TYPES: Record<SessionEntry["type"], true> = {
	message: true,
	thinking_level_change: true,
	model_change: true,
	usage: true,
	compaction: true,
	branch_summary: true,
	custom: true,
	custom_message: true,
	context_edit: true,
	label: true,
	session_info: true,
};

export function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null || !("type" in value)) return false;
	return typeof value.type === "string" && Object.hasOwn(ENTRY_TYPES, value.type);
}

/** A v1 file has no entry ids and Pi's migration mints random ones; reading must not depend on chance. */
export function positionalId(ordinal: number): string {
	return `l${ordinal}`;
}

/** v2 ids are the file's own and survive Pi's rewrite of the file; v1 ids are rewritten at random. */
export function hasStableIds(version: number): boolean {
	return version >= 2;
}

/**
 * Pi's own migration of one entry (`migrateSessionEntries`, pi-coding-agent `src/core/session-manager.ts:350`),
 * in memory only: `SessionManager.open` rewrites the file (`:1092-1094`). `ordinal` is the entry's index
 * among the file's parsed lines, header 0, the unit `firstKeptEntryIndex` counts in (`:301-310`).
 */
export function toCurrentVersion(version: number, ordinal: number, entry: SessionEntry): SessionEntry {
	if (version >= CURRENT_SESSION_VERSION) return entry;
	const keptIndex = version < 2 ? firstKeptIndex(entry) : undefined;
	const header: SessionHeader = { type: "session", version, id: "", timestamp: "", cwd: "" };
	const entries: FileEntry[] = [header, entry];
	migrateSessionEntries(entries);
	if (version < 2) {
		entry.id = positionalId(ordinal);
		entry.parentId = ordinal > 1 ? positionalId(ordinal - 1) : null;
		if (entry.type === "compaction" && keptIndex !== undefined) entry.firstKeptEntryId = positionalId(keptIndex);
	}
	return entry;
}

function firstKeptIndex(entry: SessionEntry): number | undefined {
	return entry.type === "compaction" && "firstKeptEntryIndex" in entry && typeof entry.firstKeptEntryIndex === "number"
		? entry.firstKeptEntryIndex
		: undefined;
}
