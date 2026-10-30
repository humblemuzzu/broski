/**
 * `readTranscript`: the items of the branch the transcript shows (the file's last entry, or the live
 * cut while a run is active), newest first, paged by item. A position is the entry's
 * place on the branch counted from the root, the item's index in its entry, and that item's id: appends
 * and a run's cut leave the root-side positions alone, and an id that no longer sits there refuses the cursor.
 */

import type {
	JsonValue,
	PageRequest,
	Rejected,
	SessionId,
	TranscriptItem,
	TranscriptItemId,
	TranscriptReadResult,
} from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { parseEntryPart } from "../ids";
import { isCount } from "../mapping/usage";
import type { LiveOverlay } from "../ports";
import { rejected } from "../rejections";
import { BranchItems, type ItemsOfEntry } from "./branch-items";
import { branchTo, isStillAppendedTo, lastEntryId, type SessionFileIndex } from "./jsonl-reader";
import { hasStableIds } from "./migration";
import type { SessionHead } from "./session-head";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

/** The branch a session's transcript shows, and the file it is read from. */
export interface OpenedBranch {
	readonly head: SessionHead;
	readonly file: SessionFileIndex;
	readonly items: BranchItems;
}

/** The branch the transcript shows now. */
export async function openBranch(
	index: SessionIndex,
	sessionId: SessionId,
	live: LiveOverlay,
	itemsOf: ItemsOfEntry,
): Promise<OpenedBranch | Rejected> {
	const head = await index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
	const file = await openFileIndex(index, head.path);
	if (isRejection(file)) return file;
	const cut = live.row(sessionId)?.cut;
	const leaf = cut === undefined ? lastEntryId(file) : cut.leafEntryId;
	if (leaf !== null && !file.byId.has(leaf)) {
		return rejected("backend_error", "the entry the run started after is not in the session file");
	}
	return { head, file, items: new BranchItems(file, branchTo(file, leaf), itemsOf) };
}

interface TranscriptPosition {
	readonly e: number;
	readonly j: number;
	readonly a: TranscriptItemId;
}

function isTranscriptPosition(value: JsonValue): value is TranscriptPosition & JsonValue {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		isPosition(value.e) &&
		isPosition(value.j) &&
		typeof value.a === "string" &&
		value.a.length > 0
	);
}

function isPosition(value: JsonValue | undefined): boolean {
	return typeof value === "number" && isCount(value);
}

export async function readTranscript(
	index: SessionIndex,
	sessionId: SessionId,
	page: PageRequest,
	live: LiveOverlay,
	itemsOf: ItemsOfEntry,
): Promise<TranscriptReadResult> {
	const scope = cursorScope(["transcript", sessionId]);
	const start =
		page.cursor === undefined ? undefined : decodeCursor(page.cursor, "transcript", scope, isTranscriptPosition);
	if (page.cursor !== undefined && start === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this transcript");
	}
	const opened = await openBranch(index, sessionId, live, itemsOf);
	if ("rejection" in opened) return opened;
	const walked = await walkDown(opened.items, start, page.limit);
	if (!(await isStillAppendedTo(opened.file))) {
		return rejected("backend_error", "the session file was replaced or rewritten while it was read; read it again");
	}
	if (walked === undefined) return rejected("invalid_input", "the transcript changed under this cursor");
	return {
		status: "accepted",
		page: {
			items: walked.items,
			...(walked.next !== undefined && { nextCursor: encodeCursor("transcript", scope, { ...walked.next }) }),
			idStability: hasStableIds(opened.file.version) ? "stable" : "positional",
		},
	};
}

/** Newest first from `start` (the newest item when undefined); undefined when `start` no longer names its item. */
async function walkDown(
	branch: BranchItems,
	start: TranscriptPosition | undefined,
	limit: number,
): Promise<{ items: TranscriptItem[]; next: TranscriptPosition | undefined } | undefined> {
	const items: TranscriptItem[] = [];
	let position = start === undefined ? branch.branch.length - 1 : start.e;
	if (position >= branch.branch.length) return undefined;
	for (let first = true; position >= 0; position -= 1, first = false) {
		const entryItems = await branch.itemsAt(position);
		let at = entryItems.length - 1;
		if (first && start !== undefined) {
			if (entryItems[start.j]?.id !== start.a) return undefined;
			at = start.j;
		}
		for (; at >= 0; at -= 1) {
			const item = entryItems[at];
			if (item === undefined) continue;
			if (items.length === limit) return { items, next: { e: position, j: at, a: item.id } };
			items.push(item);
		}
	}
	return { items, next: undefined };
}

/**
 * The entry an item id names, when that entry is on the branch the transcript shows now and yields that item, or when
 * the id is the first-item id of any entry of the file (`TreeNode.itemId`: a node of another branch has no item here).
 */
export async function entryOfItem(
	index: SessionIndex,
	sessionId: SessionId,
	itemId: TranscriptItemId,
	live: LiveOverlay,
	itemsOf: ItemsOfEntry,
): Promise<string | undefined | Rejected> {
	const part = parseEntryPart(itemId);
	if (part === undefined) return undefined;
	const opened = await openBranch(index, sessionId, live, itemsOf);
	if ("rejection" in opened) return opened.rejection.code === "not_found" ? undefined : opened;
	const position = opened.items.positionOf(part.entryId);
	if (position >= 0 && (await opened.items.itemsAt(position)).some((item) => item.id === itemId)) return part.entryId;
	return part.index === 0 && opened.file.byId.has(part.entryId) ? part.entryId : undefined;
}
