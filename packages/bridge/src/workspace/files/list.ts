import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileEntry, FileKind, FsListResult } from "../../contract";
import { rejected } from "../results";
import { fileSystemRejection } from "./errors";

/** Where a page ends: the last entry's rank (directories `0`, the rest `1`) and name, so a cursor survives inserts. */
type Position = { readonly rank: number; readonly name: string };

/**
 * One page of the directory `path` (canonical, past the path policy): directories first, then by name ignoring
 * case, names starting with a dot only when `hidden`. The cursor is the last entry's position, so a page goes on
 * after it even when the directory changed in between.
 */
export async function listDirectory(
	path: string,
	query: { cursor?: string; hidden?: boolean },
	limit: number,
): Promise<FsListResult> {
	const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
	if (after === null) return rejected("invalid_input", "the cursor is not one this bridge gave out");
	let dirents: Dirent[];
	try {
		dirents = await readdir(path, { withFileTypes: true });
	} catch (error) {
		return fileSystemRejection(error, path);
	}
	const sorted = dirents
		.filter((dirent) => query.hidden === true || !dirent.name.startsWith("."))
		.map((dirent) => ({ rank: dirent.isDirectory() ? 0 : 1, name: dirent.name, kind: kindOf(dirent) }))
		.sort(compare)
		.filter((entry) => after === undefined || compare(entry, after) > 0);
	const page = sorted.slice(0, limit);
	const entries = await Promise.all(page.map((entry) => described(path, entry.name, entry.kind)));
	const last = page.at(-1);
	return {
		status: "accepted",
		path,
		entries,
		...(last && sorted.length > limit && { nextCursor: encodeCursor(last) }),
	};
}

function kindOf(dirent: Dirent): FileKind {
	if (dirent.isFile()) return "file";
	if (dirent.isDirectory()) return "dir";
	if (dirent.isSymbolicLink()) return "symlink";
	return "other";
}

function compare(a: Position, b: Position): number {
	if (a.rank !== b.rank) return a.rank - b.rank;
	const folded = byCodeUnits(a.name.toLowerCase(), b.name.toLowerCase());
	return folded !== 0 ? folded : byCodeUnits(a.name, b.name);
}

function byCodeUnits(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The entry's size and time, without following a link; an entry gone since the listing keeps its name and kind. */
async function described(directory: string, name: string, kind: FileKind): Promise<FileEntry> {
	try {
		const stats = await lstat(join(directory, name));
		return { name, kind, ...(kind === "file" && { size: stats.size }), modifiedAt: Math.floor(stats.mtimeMs) };
	} catch {
		return { name, kind };
	}
}

function encodeCursor(position: Position): string {
	return `${position.rank}/${position.name}`;
}

/** A name holds no `/`, so the first one ends the rank; null for a cursor this bridge did not write. */
function decodeCursor(cursor: string): Position | null {
	const match = /^([01])\/([^/]+)$/.exec(cursor);
	return match ? { rank: Number(match[1]), name: match[2] ?? "" } : null;
}
