/** What a host starts from: where a session's file is, and what the file says (`SessionStore.locate`, `facts`). */

import type { Rejected, SessionId } from "../../../contract";
import { type PermissionsRecord, readPermissionsRecord } from "../broski-entries";
import type { StoredFacts, StoredSession } from "../ports";
import { rejected } from "../rejections";
import { type EntrySpan, lastEntryId, readEntries, type SessionFileIndex } from "./jsonl-reader";
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
	return {
		lastEntryId: hasStableIds(file.version) ? lastEntryId(file) : null,
		permissions: await lastPermissions(file),
		summary: found.status === "accepted" ? found.summary : undefined,
	};
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
