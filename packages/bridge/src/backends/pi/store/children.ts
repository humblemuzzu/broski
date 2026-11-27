/**
 * The sessions that are children of a Pi session because one of its tool calls ran a sub-run: listed under the
 * parent (`SessionQuery.parent`), read as a session (`getSession`), and read as a transcript, all from the
 * parent's file. A child is not a file: it has no id of its own beyond the parent's and the call's (`ids.ts`).
 */

import { rejected } from "../../../adapter-kit/rejections";
import type {
	JsonValue,
	PageRequest,
	Rejected,
	SessionGetResult,
	SessionId,
	SessionSummary,
	TranscriptReadResult,
} from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { parseChildSessionId } from "../ids";
import { childSummary } from "../mapping/child-summary";
import { subRunItems } from "../mapping/sub-run-items";
import { isCount } from "../mapping/usage";
import type { LiveOverlay } from "../ports";
import type { ListedRow } from "./listed-row";
import type { ToolChild, ToolChildren } from "./tool-children";

export interface ChildDeps {
	readonly children: ToolChildren;
	readonly live: LiveOverlay;
}

function summaryOf(deps: ChildDeps, parent: SessionSummary, child: ToolChild): SessionSummary | undefined {
	const draft = childSummary({
		parent,
		piToolCallId: child.piToolCallId,
		title: child.title,
		updatedAt: child.at,
		status: "idle",
	});
	if (draft === undefined) return undefined;
	const hosted = deps.live.row(draft.session.sessionId);
	return hosted === undefined ? draft : { ...draft, status: hosted.status };
}

/** The children of `parent` as rows of a listing. */
export async function childRows(deps: ChildDeps, parent: SessionSummary): Promise<ListedRow[] | Rejected> {
	const read = await deps.children.of(parent.session.sessionId);
	if ("rejection" in read) return read;
	const rows: ListedRow[] = [];
	for (const child of read.children) {
		const summary = summaryOf(deps, parent, child);
		if (summary !== undefined)
			rows.push({ updatedAt: summary.updatedAt, sessionId: summary.session.sessionId, summary: async () => summary });
	}
	return rows;
}

interface Located {
	readonly parent: SessionSummary;
	/** Absent for a child whose tool call still runs: its result is not in the file yet. */
	readonly child: ToolChild | undefined;
	readonly summary: SessionSummary;
}

async function locate(
	deps: ChildDeps,
	parentOf: (parentId: SessionId) => Promise<SessionGetResult>,
	childId: SessionId,
): Promise<Located | Rejected> {
	const part = parseChildSessionId(childId);
	if (part === undefined) return rejected("not_found", `no Pi session ${childId}`);
	const parent = await parentOf(part.parentId);
	if (parent.status === "rejected") return parent;
	const read = await deps.children.of(part.parentId);
	if ("rejection" in read) return read;
	const child = read.children.find((candidate) => candidate.piToolCallId === part.piToolCallId);
	const summary =
		child === undefined
			? deps.live.unwritten?.(part.parentId).find((row) => row.session.sessionId === childId)
			: summaryOf(deps, parent.summary, child);
	if (summary === undefined) return rejected("not_found", `no Pi session ${childId}`);
	return { parent: parent.summary, child, summary };
}

export async function getChild(
	deps: ChildDeps,
	parentOf: (parentId: SessionId) => Promise<SessionGetResult>,
	childId: SessionId,
): Promise<SessionGetResult> {
	const found = await locate(deps, parentOf, childId);
	return "rejection" in found ? found : { status: "accepted", summary: found.summary };
}

interface ChildPosition {
	readonly i: number;
	readonly a: string;
}

function isChildPosition(value: JsonValue): value is ChildPosition & JsonValue {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof value.i === "number" &&
		isCount(value.i) &&
		typeof value.a === "string"
	);
}

/** The child's items newest first, paged by position, as a transcript is. */
export async function childTranscript(
	deps: ChildDeps,
	parentOf: (parentId: SessionId) => Promise<SessionGetResult>,
	childId: SessionId,
	page: PageRequest,
): Promise<TranscriptReadResult> {
	const scope = cursorScope(["child-transcript", childId]);
	const start = page.cursor === undefined ? undefined : decodeCursor(page.cursor, "transcript", scope, isChildPosition);
	if (page.cursor !== undefined && start === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this transcript");
	}
	const found = await locate(deps, parentOf, childId);
	if ("rejection" in found) return found;
	if (found.child === undefined || deps.live.row(childId)?.cut !== undefined) {
		return { status: "accepted", page: { items: [], idStability: "positional" } };
	}
	const read = await deps.children.of(found.parent.session.sessionId);
	if ("rejection" in read) return read;
	const { child } = found;
	const items = subRunItems(await deps.children.runsOf(read.file, child), child.at);
	const from = start === undefined ? items.length - 1 : start.i;
	if (start !== undefined && items[from]?.id !== start.a)
		return rejected("invalid_input", "the transcript changed under this cursor");
	const shown = items.slice(Math.max(0, from - page.limit + 1), from + 1).reverse();
	const next = from - shown.length;
	const nextItem = next >= 0 ? items[next] : undefined;
	return {
		status: "accepted",
		page: {
			items: shown,
			...(nextItem !== undefined && { nextCursor: encodeCursor("transcript", scope, { i: next, a: nextItem.id }) }),
			idStability: "positional",
		},
	};
}
