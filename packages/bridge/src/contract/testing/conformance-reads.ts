import type { AgentBackend } from "../backend";
import type { SessionRef } from "../ids";
import type { SessionQuery, SessionSummary } from "../sessions";
import type { TranscriptItem } from "../transcript";
import { expect, fail } from "./conformance-harness";

/** Every row of a listing, page by page, checking each page keeps to `limit`. */
export async function allPages(backend: AgentBackend, query: SessionQuery, limit: number): Promise<SessionSummary[]> {
	const rows: SessionSummary[] = [];
	let cursor: string | undefined;
	do {
		const page = await backend.listSessions(query, { limit, ...(cursor !== undefined && { cursor }) });
		if (page.status === "rejected") fail(`listSessions was rejected: ${page.rejection.message}`);
		expect(page.page.items.length <= limit, `a page holds more than ${limit} rows`);
		rows.push(...page.page.items);
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return rows;
}

/** Every item of a transcript, newest first, page by page. */
export async function allTranscript(backend: AgentBackend, ref: SessionRef, limit: number): Promise<TranscriptItem[]> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await backend.readTranscript(ref, { limit, ...(cursor !== undefined && { cursor }) });
		if (page.status === "rejected") fail(`readTranscript was rejected: ${page.rejection.message}`);
		expect(page.page.items.length <= limit, `a transcript page holds more than ${limit} items`);
		items.push(...page.page.items);
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return items;
}

/** Whether a listing of `query` holds the session. */
export async function listed(backend: AgentBackend, query: SessionQuery, ref: SessionRef): Promise<boolean> {
	const rows = await allPages(backend, query, 50);
	return rows.some((row) => row.session.sessionId === ref.sessionId);
}
