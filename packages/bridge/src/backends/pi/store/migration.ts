import { CURRENT_SESSION_VERSION, type SessionEntry } from "./entries";

const ENTRY_TYPES: ReadonlySet<string> = new Set([
	"message",
	"thinking_level_change",
	"model_change",
	"usage",
	"compaction",
	"branch_summary",
	"custom",
	"custom_message",
	"context_edit",
	"label",
	"session_info",
]);

/** An entry of a type Pi writes (pi-coding-agent 1.5.2 `docs/session-format.md:62-207`); a newer Pi's other types are skipped. */
export function isSessionEntry(value: unknown): value is SessionEntry {
	if (typeof value !== "object" || value === null || !("type" in value)) return false;
	return typeof value.type === "string" && ENTRY_TYPES.has(value.type);
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
 * Pi's migration of one entry (`migrateV1ToV2`, `migrateV2ToV3`, pi-coding-agent 1.5.2
 * `dist/core/session-manager.js:30-85`), in memory only: Pi rewrites the file when it opens one. A v1 entry gets
 * positional ids and a compaction's `firstKeptEntryIndex` (an index among the file's parsed lines, header 0) becomes
 * the id of that line; a v2 message of the role `hookMessage` is `custom`. `ordinal` is the entry's index among those lines.
 */
export function toCurrentVersion(version: number, ordinal: number, entry: SessionEntry): SessionEntry {
	if (version >= CURRENT_SESSION_VERSION) return entry;
	if (version < 2) {
		entry.id = positionalId(ordinal);
		entry.parentId = ordinal > 1 ? positionalId(ordinal - 1) : null;
		const keptIndex = firstKeptIndex(entry);
		if (entry.type === "compaction" && keptIndex !== undefined) {
			if (keptIndex > 0) entry.firstKeptEntryId = positionalId(keptIndex);
			Reflect.deleteProperty(entry, "firstKeptEntryIndex");
		}
	}
	if (entry.type === "message" && roleOf(entry.message) === "hookMessage")
		Object.assign(entry.message, { role: "custom" });
	return entry;
}

/** A role as the file holds it, which may be one Pi has renamed since. */
function roleOf(message: { readonly role: string }): string {
	return message.role;
}

function firstKeptIndex(entry: SessionEntry): number | undefined {
	return entry.type === "compaction" && "firstKeptEntryIndex" in entry && typeof entry.firstKeptEntryIndex === "number"
		? entry.firstKeptEntryIndex
		: undefined;
}
