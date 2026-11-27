/** What a host starts from: where a session's file is, and what the file says (`SessionStore.locate`, `facts`). */

import { rejected } from "../../../adapter-kit/rejections";
import { MAX_NAME_CHARS, type Rejected, type SessionId } from "../../../contract";
import { type PermissionsRecord, readPermissionsRecord } from "../broski-entries";
import type { RecentEntries, StoredFacts, StoredSession } from "../ports";
import type { PiEntry } from "../rpc/replies";
import { branchTo, type EntrySpan, lastEntryId, readEntries, type SessionFileIndex } from "./jsonl-reader";
import { getSession, NO_LIVE } from "./list";
import { hasStableIds } from "./migration";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

export async function locateStored(index: SessionIndex, sessionId: SessionId): Promise<StoredSession | Rejected> {
	const head = await index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
	const { origin } = await index.complete(head);
	return { sessionId, path: head.path, cwd: head.cwd, origin };
}

export async function storedFacts(index: SessionIndex, session: StoredSession): Promise<StoredFacts | Rejected> {
	const file = await openFileIndex(index, session.path);
	if (isRejection(file)) return file;
	const found = await getSession(index, session.sessionId, NO_LIVE);
	const thinking = await lastThinking(file);
	return {
		lastEntryId: hasStableIds(file.version) ? lastEntryId(file) : null,
		permissions: await lastPermissions(file),
		summary: found.status === "accepted" ? found.summary : undefined,
		...(thinking !== undefined && { thinking }),
	};
}

/** The newest `thinking_level_change` on the active branch, so a dormant view shows the session's level immediately. */
async function lastThinking(file: SessionFileIndex): Promise<string | undefined> {
	const spans = hasStableIds(file.version) ? branchTo(file, lastEntryId(file)) : file.entries;
	const changes = spans.filter((span) => span.type === "thinking_level_change").reverse();
	for (const span of changes) {
		const [entry] = await readEntries(file, [span]);
		if (
			entry?.type === "thinking_level_change" &&
			entry.thinkingLevel.length > 0 &&
			entry.thinkingLevel.length <= MAX_NAME_CHARS
		) {
			return entry.thinkingLevel;
		}
	}
	return undefined;
}

/** The newest `broski.permissions` entry anywhere in the file: a guard that was on stays on across a branch change. */
async function lastPermissions(file: SessionFileIndex): Promise<PermissionsRecord> {
	const customs: EntrySpan[] = file.entries.filter((span) => span.type === "custom").reverse();
	for (const span of customs) {
		const [entry] = await readEntries(file, [span]);
		const record = entry === undefined ? undefined : readPermissionsRecord(entry);
		if (record !== undefined) return record;
	}
	return { mode: "off", allowedTools: [] };
}

/** Enough to cover a long run's messages, which come after its user message; a longer one loses the oldest ids. */
const MAX_RECENT_ENTRIES = 2_000;

/** The branch's entries from its last user message on, as `get_entries` would give them, and the prompts' records. */
export async function recentEntries(index: SessionIndex, session: StoredSession): Promise<RecentEntries | Rejected> {
	const file = await openFileIndex(index, session.path);
	if (isRejection(file)) return file;
	const prompts = (entryId: string) => file.records.get(entryId)?.prompt;
	if (!hasStableIds(file.version)) return { entries: [], prompts };
	const branch = branchTo(file, lastEntryId(file));
	let from = branch.length - 1;
	while (from > 0 && branch.length - from < MAX_RECENT_ENTRIES && branch[from]?.role !== "user") from -= 1;
	const spans = branch.slice(Math.max(0, from));
	const entries: PiEntry[] = [];
	for (const entry of await readEntries(file, spans)) {
		if (entry === undefined) continue;
		const { id, parentId, type } = entry;
		const message = entry.type === "message" && entry.message.role !== "other" ? entry.message : undefined;
		const toolCallId = message?.role === "toolResult" ? message.toolCallId : undefined;
		entries.push({
			id,
			parentId,
			type,
			...(message !== undefined && {
				message: { role: message.role, timestamp: message.timestamp, ...(toolCallId !== undefined && { toolCallId }) },
			}),
		});
	}
	return { entries, prompts };
}
