/**
 * `changed_files` (D22): the files a session's tool calls changed, folded per file from the transcript's own tool
 * results, so this agrees with what the chat shows call by call. Newest page first; the walk stops at `MAX_PAGES`.
 */

import {
	type BackendCallResult,
	type ChangedFilesOp,
	type FileChange,
	MAX_LIST_ITEMS,
	type TranscriptItem,
} from "../../../contract";
import type { OpsDeps } from "../ports";
import { rejected } from "../rejections";
import { guarded } from "./guard";

const PAGE_LIMIT = 200;
const MAX_PAGES = 60;

interface Folded {
	readonly path: string;
	additions?: number;
	deletions?: number;
	edits: number;
}

function fold(byPath: Map<string, Folded>, item: TranscriptItem): void {
	if (item.kind !== "tool_result" || item.outcome !== "completed") return;
	for (const change of item.result.fileChanges) {
		const known = byPath.get(change.path) ?? { path: change.path, edits: 0 };
		known.edits += 1;
		if (change.additions !== undefined) known.additions = (known.additions ?? 0) + change.additions;
		if (change.deletions !== undefined) known.deletions = (known.deletions ?? 0) + change.deletions;
		byPath.set(change.path, known);
	}
}

function listed(byPath: ReadonlyMap<string, Folded>) {
	const all = [...byPath.values()].sort(
		(a, b) => b.edits - a.edits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
	);
	let additions = 0;
	let deletions = 0;
	for (const file of all) {
		additions += file.additions ?? 0;
		deletions += file.deletions ?? 0;
	}
	const files = all.slice(0, MAX_LIST_ITEMS).map(
		(file): FileChange => ({
			path: file.path,
			change: "modified",
			...(file.additions !== undefined && { additions: file.additions }),
			...(file.deletions !== undefined && { deletions: file.deletions }),
		}),
	);
	return {
		kind: "changed_files" as const,
		files,
		omitted: Math.max(0, all.length - MAX_LIST_ITEMS),
		additions,
		deletions,
	};
}

export async function changedFiles(deps: OpsDeps, op: ChangedFilesOp): Promise<BackendCallResult> {
	return guarded("changed_files", async () => {
		const byPath = new Map<string, Folded>();
		let cursor: string | undefined;
		for (let page = 0; page < MAX_PAGES; page += 1) {
			const read = await deps.store.transcript(
				op.sessionId,
				{ limit: PAGE_LIMIT, ...(cursor && { cursor }) },
				deps.live,
			);
			if (read.status === "rejected") return page === 0 ? read : rejected("backend_error", read.rejection.message);
			for (const item of read.page.items) fold(byPath, item);
			cursor = read.page.nextCursor;
			if (cursor === undefined) break;
		}
		return listed(byPath);
	});
}
