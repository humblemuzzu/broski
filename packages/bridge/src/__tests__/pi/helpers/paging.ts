/** Whole listings and transcripts, page by page, failing instead of looping when a cursor never ends. */

import type { AgentBackend, SessionQuery, SessionRef, SessionSummary, TranscriptItem } from "../../../contract";

/** A test reads a handful of pages; a backend whose cursor never ends would otherwise fill memory. */
const MAX_PAGES = 200;

interface Page<T> {
	readonly items: readonly T[];
	readonly nextCursor?: string;
}

export async function drain<T>(
	what: string,
	read: (cursor: string | undefined) => Promise<Page<T>>,
	from?: string,
): Promise<T[]> {
	const items: T[] = [];
	let cursor = from;
	for (let pages = 0; pages < MAX_PAGES; pages++) {
		const page = await read(cursor);
		items.push(...page.items);
		cursor = page.nextCursor;
		if (cursor === undefined) return items;
	}
	throw new Error(`${what} still had a next page after ${MAX_PAGES} pages: its cursor never ends`);
}

export function allRows(backend: AgentBackend, query: SessionQuery, limit: number): Promise<SessionSummary[]> {
	return drain("the session listing", async (cursor) => {
		const result = await backend.listSessions(query, { limit, ...(cursor !== undefined && { cursor }) });
		if (result.status === "rejected") throw new Error(`listSessions was rejected: ${result.rejection.message}`);
		return result.page;
	});
}

export function allItems(
	backend: Pick<AgentBackend, "readTranscript">,
	ref: SessionRef,
	limit: number,
	from?: string,
): Promise<TranscriptItem[]> {
	return drain(
		"the transcript",
		async (cursor) => {
			const result = await backend.readTranscript(ref, { limit, ...(cursor !== undefined && { cursor }) });
			if (result.status === "rejected") throw new Error(`readTranscript was rejected: ${result.rejection.message}`);
			return result.page;
		},
		from,
	);
}
