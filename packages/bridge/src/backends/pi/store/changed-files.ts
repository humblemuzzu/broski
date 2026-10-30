/**
 * The files a session's tool calls changed, as the old session sidebar listed them: every `edit` and `write` result on
 * the branch the transcript shows, folded per file with the lines added and removed across all its edits. The results
 * are the transcript's own `fileChanges`, so this agrees with what the chat shows call by call.
 */

import {
	type ChangedFilesListed,
	type FileChange,
	MAX_LIST_ITEMS,
	type Rejected,
	type SessionId,
} from "../../../contract";
import type { LiveOverlay } from "../ports";
import type { ItemsOfEntry } from "./branch-items";
import type { SessionIndex } from "./session-index";
import { openBranch } from "./transcript";

interface Folded {
	readonly path: string;
	additions?: number;
	deletions?: number;
	edits: number;
}

export async function readChangedFiles(
	index: SessionIndex,
	sessionId: SessionId,
	live: LiveOverlay,
	itemsOf: ItemsOfEntry,
): Promise<ChangedFilesListed | Rejected> {
	const opened = await openBranch(index, sessionId, live, itemsOf);
	if ("rejection" in opened) return opened;
	const byPath = new Map<string, Folded>();
	for (let position = 0; position < opened.items.branch.length; position += 1) {
		for (const item of await opened.items.itemsAt(position)) {
			if (item.kind === "tool_result") fold(byPath, item.result.fileChanges);
		}
	}
	return changedFiles(byPath);
}

/** Adds `changes` to what is known of each path: a count is summed, and stays absent while no change reported one. */
function fold(byPath: Map<string, Folded>, changes: readonly FileChange[]): void {
	for (const change of changes) {
		const known = byPath.get(change.path) ?? { path: change.path, edits: 0 };
		known.edits += 1;
		if (change.additions !== undefined) known.additions = (known.additions ?? 0) + change.additions;
		if (change.deletions !== undefined) known.deletions = (known.deletions ?? 0) + change.deletions;
		byPath.set(change.path, known);
	}
}

/** The most edited files first, then by path; `omitted` counts those past `MAX_LIST_ITEMS`, the totals cover all. */
function changedFiles(byPath: ReadonlyMap<string, Folded>): ChangedFilesListed {
	const all = [...byPath.values()].sort(
		(a, b) => b.edits - a.edits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
	);
	let additions = 0;
	let deletions = 0;
	for (const file of all) {
		additions += file.additions ?? 0;
		deletions += file.deletions ?? 0;
	}
	return {
		kind: "changed_files",
		files: all.slice(0, MAX_LIST_ITEMS).map(
			(file): FileChange => ({
				path: file.path,
				change: "modified",
				...(file.additions !== undefined && { additions: file.additions }),
				...(file.deletions !== undefined && { deletions: file.deletions }),
			}),
		),
		omitted: Math.max(0, all.length - MAX_LIST_ITEMS),
		additions,
		deletions,
	};
}
