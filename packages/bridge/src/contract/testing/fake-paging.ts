import { z } from "zod";
import type { JsonValue } from "../json";
import type { PageRequest } from "../paging";
import type { SessionsListResult, TranscriptReadResult } from "../read-results";
import type { Rejected } from "../rejection";
import type { SessionSummary } from "../sessions";
import type { TranscriptEntry } from "./fake-history";

/** The last row of the previous page: its `updatedAt` and session id. */
const RowCursor = z.tuple([z.int(), z.string()]);

/** The write position of the last item of the previous page. */
const EntryCursor = z.int();

/** Newest updated first, session id breaking ties. */
export function sessionPage(rows: readonly SessionSummary[], page: PageRequest): SessionsListResult {
	const after = page.cursor === undefined ? undefined : decode(page.cursor, RowCursor);
	if (after === null) return badCursor();
	const sorted = [...rows].sort(
		(a, b) => b.updatedAt - a.updatedAt || compare(b.session.sessionId, a.session.sessionId),
	);
	const remaining =
		after === undefined
			? sorted
			: sorted.filter(
					(row) => row.updatedAt < after[0] || (row.updatedAt === after[0] && row.session.sessionId < after[1]),
				);
	const items = remaining.slice(0, page.limit);
	const last = items.at(-1);
	return {
		status: "accepted",
		page: {
			items,
			...(last && remaining.length > items.length && { nextCursor: encode([last.updatedAt, last.session.sessionId]) }),
		},
	};
}

/** Newest first. */
export function transcriptPage(entries: readonly TranscriptEntry[], page: PageRequest): TranscriptReadResult {
	const after = page.cursor === undefined ? undefined : decode(page.cursor, EntryCursor);
	if (after === null) return badCursor();
	const remaining = entries.filter((entry) => after === undefined || entry.seq < after).sort((a, b) => b.seq - a.seq);
	const items = remaining.slice(0, page.limit);
	const last = items.at(-1);
	return {
		status: "accepted",
		page: {
			items: items.map((entry) => entry.item),
			...(last && remaining.length > items.length && { nextCursor: encode(last.seq) }),
			idStability: "stable",
		},
	};
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function encode(value: z.infer<typeof RowCursor> | number): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Null for a cursor this fake did not mint. */
function decode<T>(cursor: string, schema: z.ZodType<T>): T | null {
	let json: JsonValue;
	try {
		json = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	const parsed = schema.safeParse(json);
	return parsed.success ? parsed.data : null;
}

function badCursor(): Rejected {
	return { status: "rejected", rejection: { code: "invalid_input", message: "this cursor was not minted here" } };
}
