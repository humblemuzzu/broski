/**
 * Chooses which part of a Pi session's entry list a transcript read actually needs, and loads that
 * part as real entries.
 *
 * The session is a tree: the context is the leaf-to-root path, cut at the newest compaction on that
 * path. A read that only wants the last N messages therefore needs a suffix of that path, plus the
 * entries a compaction keeps — but never the parts of the file that branch away from it.
 */

import type { CompactionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { type PiSessionFileIndex, readPiEntryAt, readPiEntryLines } from "./pi-session-index";

export type PiSessionWindowPlan = {
	/** Position in `path` where the window starts. */
	start: number;
	leafId: string;
};

export type PiSessionWindow = {
	entries: SessionEntry[];
	leafId: string;
	start: number;
};

export type EntryLoader = (position: number) => Promise<SessionEntry | null>;

/** A repeated id makes the parent chain loop; the SDK's own path walk never returns on one. */
export class PiSessionCycleError extends Error {
	constructor(sessionPath: string) {
		super(`Pi session ${sessionPath} has a repeated id, so its parent chain loops`);
		this.name = "PiSessionCycleError";
	}
}

/** Positions of the leaf-to-root path, root first, or null when the file has no usable leaf. */
export function piSessionPath(index: PiSessionFileIndex, sessionPath = "session file"): number[] | null {
	const { entries, byId } = index;
	if (entries.length === 0) return null;
	const path: number[] = [];
	const seen = new Set<number>();
	let current: number | undefined = entries.length - 1;

	while (current !== undefined) {
		if (seen.has(current)) throw new PiSessionCycleError(sessionPath);
		seen.add(current);
		path.push(current);
		const parentId: string | null = entries[current]?.parentId ?? null;
		current = parentId === null ? undefined : byId.get(parentId);
	}

	path.reverse();
	return path;
}

export function leafEntryId(index: PiSessionFileIndex, path: number[]): string | null {
	const leaf = path[path.length - 1];
	if (leaf === undefined) return null;
	return index.entries[leaf]?.id ?? null;
}

/** Path position of the newest compaction on the path, or -1. */
export function newestCompactionPosition(index: PiSessionFileIndex, path: number[]): number {
	for (let i = path.length - 1; i >= 0; i--) {
		const position = path[i];
		if (position !== undefined && index.entries[position]?.type === "compaction") return i;
	}
	return -1;
}

/**
 * Moves `start` back far enough that a compaction inside the window still gets the entries it keeps,
 * since the compaction summary replaces everything before `firstKeptEntryId`.
 */
export async function planPiSessionWindow(
	index: PiSessionFileIndex,
	path: number[],
	requestedStart: number,
	load: EntryLoader,
): Promise<PiSessionWindowPlan | null> {
	const leafId = leafEntryId(index, path);
	if (leafId === null) return null;

	const start = Math.max(0, Math.min(requestedStart, path.length - 1));
	const compactionPosition = newestCompactionPosition(index, path);
	if (compactionPosition < start) return { start, leafId };

	const compaction = (await load(path[compactionPosition] as number)) as CompactionEntry | null;
	if (!compaction) return null;

	const firstKeptId = typeof compaction.firstKeptEntryId === "string" ? compaction.firstKeptEntryId : "";
	if (!firstKeptId) return { start, leafId };

	const keptEntry = index.byId.get(firstKeptId);
	const keptPosition = keptEntry === undefined ? -1 : path.indexOf(keptEntry);
	if (keptPosition >= 0 && keptPosition < start) return { start: keptPosition, leafId };

	return { start, leafId };
}

/**
 * Reads the planned window back from disk and checks it still forms the same chain: a line that no
 * longer parses, or whose `parentId` left the chain, means the caller must fall back to a full read.
 */
export async function readPiSessionWindow(
	path: string,
	index: PiSessionFileIndex,
	plan: PiSessionWindowPlan,
	entryPath: number[],
): Promise<PiSessionWindow | null> {
	const positions = entryPath.slice(plan.start);
	const refs = positions.map((position) => index.entries[position]);
	const loaded = await readPiEntryLines(path, refs);
	if (loaded.some((entry) => entry === null)) return null;

	const entries = loaded as SessionEntry[];
	for (let i = 1; i < entries.length; i++) {
		const expectedParent = index.entries[positions[i - 1] as number]?.id;
		if (entries[i]?.parentId !== expectedParent) return null;
	}

	if (!(await editsOutsideWindowAreIrrelevant(path, index, entryPath, plan.start, entries))) return null;

	return { entries, leafId: plan.leafId, start: plan.start };
}

/**
 * A `context_edit` rewrites an earlier entry's contribution, and is appended after its target. An
 * edit placed *before* the window whose target is inside it would therefore be missed, so that case
 * escalates instead of returning a window that disagrees with a full read.
 */
async function editsOutsideWindowAreIrrelevant(
	path: string,
	index: PiSessionFileIndex,
	entryPath: number[],
	start: number,
	entries: SessionEntry[],
): Promise<boolean> {
	const windowIds = new Set(entries.map((entry) => entry.id));
	for (let i = 0; i < start; i++) {
		const position = entryPath[i];
		if (position === undefined) continue;
		const ref = index.entries[position];
		if (ref?.type !== "context_edit") continue;
		const edit = (await readPiEntryAt(path, ref)) as { targetId?: unknown } | null;
		const targetId = typeof edit?.targetId === "string" ? edit.targetId : null;
		if (targetId && windowIds.has(targetId)) return false;
	}
	return true;
}
