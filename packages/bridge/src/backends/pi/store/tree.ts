/**
 * `read_tree`: the entries of a session file as the tree `/tree` shows, newest first and a page at a time, read
 * from the file's span index so a session nobody hosts reads like one this bridge runs (D6). A node's parent is
 * the nearest shown ancestor; a label is the last `label` entry that names the node (`session-manager.ts` keeps
 * `labelsById` the same way: a blank label clears).
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { JsonValue, PageRequest, Rejected, SessionId, TreeNode, TreeRead } from "../../../contract";
import { cursorScope, decodeCursor, encodeCursor } from "../cursor";
import { isShownType, treeNodeOf } from "../mapping/tree-nodes";
import { isCount } from "../mapping/usage";
import { rejected } from "../rejections";
import { type EntrySpan, isStillAppendedTo, lastEntryId, readEntries, type SessionFileIndex } from "./jsonl-reader";
import { isRejection, openFileIndex, type SessionIndex } from "./session-index";

const LABEL_READ_BATCH = 256;

interface TreePosition {
	readonly i: number;
	readonly a: string;
}

function isTreePosition(value: JsonValue): value is TreePosition & JsonValue {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof value.i === "number" &&
		isCount(value.i) &&
		typeof value.a === "string" &&
		value.a.length > 0
	);
}

/** What one file index says of the tree, worked out once per index: the shown entries and their labels. */
interface Shape {
	readonly shown: readonly EntrySpan[];
	readonly labels: ReadonlyMap<string, string>;
}

const shapes = new WeakMap<SessionFileIndex, Promise<Shape>>();

function shapeOf(file: SessionFileIndex): Promise<Shape> {
	let shape = shapes.get(file);
	if (shape === undefined) {
		shape = labelsOf(file).then((labels) => ({ shown: file.entries.filter((span) => isShownType(span.type)), labels }));
		shapes.set(file, shape);
	}
	return shape;
}

async function labelsOf(file: SessionFileIndex): Promise<Map<string, string>> {
	const labels = new Map<string, string>();
	const spans = file.entries.filter((span) => span.type === "label");
	for (let at = 0; at < spans.length; at += LABEL_READ_BATCH) {
		for (const entry of await readEntries(file, spans.slice(at, at + LABEL_READ_BATCH))) {
			if (entry?.type !== "label") continue;
			if (entry.label) labels.set(entry.targetId, entry.label);
			else labels.delete(entry.targetId);
		}
	}
	return labels;
}

export async function readTree(
	index: SessionIndex,
	sessionId: SessionId,
	page: PageRequest,
): Promise<TreeRead | Rejected> {
	const scope = cursorScope(["tree", sessionId]);
	const start = page.cursor === undefined ? undefined : decodeCursor(page.cursor, "tree", scope, isTreePosition);
	if (page.cursor !== undefined && start === undefined) {
		return rejected("invalid_input", "this cursor was not minted by this tree");
	}
	const head = await index.find(sessionId);
	if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
	const file = await openFileIndex(index, head.path);
	if (isRejection(file)) return file;
	const { shown, labels } = await shapeOf(file);
	const from = start === undefined ? shown.length - 1 : start.i;
	if (start !== undefined && shown[from]?.entryId !== start.a) {
		return rejected("invalid_input", "the tree changed under this cursor");
	}
	const spans = shown.slice(Math.max(0, from - page.limit + 1), from + 1).reverse();
	const nodes = await nodesOf(file, spans, labels);
	if (!(await isStillAppendedTo(file))) {
		return rejected("backend_error", "the session file was replaced or rewritten while it was read; read it again");
	}
	const next = from - spans.length;
	const nextAt = next >= 0 ? shown[next] : undefined;
	const leaf = shownAncestor(file, lastEntryId(file));
	return {
		kind: "read_tree",
		...(leaf !== undefined && { leafId: leaf }),
		total: shown.length,
		nodes,
		...(nextAt !== undefined && { nextCursor: encodeCursor("tree", scope, { i: next, a: nextAt.entryId }) }),
	};
}

async function nodesOf(
	file: SessionFileIndex,
	spans: readonly EntrySpan[],
	labels: ReadonlyMap<string, string>,
): Promise<TreeNode[]> {
	const entries = await readEntries(file, spans);
	const nodes: TreeNode[] = [];
	entries.forEach((entry: SessionEntry | undefined, at) => {
		const span = spans[at];
		if (entry === undefined || span === undefined) return;
		const parentId = span.parentId === null ? undefined : shownAncestor(file, span.parentId);
		const node = treeNodeOf(entry, { parentId, label: labels.get(entry.id) });
		if (node !== undefined) nodes.push(node);
	});
	return nodes;
}

/** `entryId`, or the nearest ancestor that is shown; undefined past the root or at a parent the file does not hold. */
function shownAncestor(file: SessionFileIndex, entryId: string | null): string | undefined {
	const seen = new Set<string>();
	let current = entryId;
	while (current !== null && !seen.has(current)) {
		seen.add(current);
		const position = file.byId.get(current);
		const span = position === undefined ? undefined : file.entries[position];
		if (span === undefined) return undefined;
		if (isShownType(span.type)) return span.entryId;
		current = span.parentId;
	}
	return undefined;
}
