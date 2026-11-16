/**
 * Every session file of some project directories, newest first, from `readdir` and `stat` alone (no file is
 * opened), the way the SDK's own listing finds them (`sdk.mjs` `ig`): `<uuid>.jsonl`, ordered like `$we`.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "../ids";

export interface Candidate {
	readonly sessionId: string;
	readonly dir: string;
	/** `stat().mtime.getTime()`: what the SDK sorts by and reports as `lastModified`. */
	readonly mtime: number;
}

/** Where a row stands in a listing: its `updatedAt`, then its id. */
export interface Position {
	readonly at: number;
	readonly sessionId: string;
}

/** Newest first; on a tie the greater `sessionId` first (as the SDK's lister orders them, `__tests__/claude-code/foundation/session_order.test.ts`). */
export function byNewest(a: Position, b: Position): number {
	return b.at - a.at || greaterIdFirst(a.sessionId, b.sessionId);
}

function greaterIdFirst(a: string, b: string): number {
	return a < b ? 1 : a > b ? -1 : 0;
}

export function isAfter(candidate: Position, position: Position): boolean {
	return byNewest(position, candidate) < 0;
}

async function dirCandidates(root: string, dir: string): Promise<Candidate[]> {
	let names: string[];
	try {
		names = await readdir(join(root, "projects", dir));
	} catch {
		return [];
	}
	const found = await Promise.all(
		names.map(async (name): Promise<Candidate | undefined> => {
			const sessionId = name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : "";
			if (!isUuid(sessionId)) return undefined;
			try {
				const stats = await stat(join(root, "projects", dir, name));
				return stats.isFile() ? { sessionId, dir, mtime: stats.mtime.getTime() } : undefined;
			} catch {
				return undefined;
			}
		}),
	);
	return found.filter((candidate) => candidate !== undefined);
}

/** All files of `dirs`, newest mtime first, one per session id (the newest copy wins, as in the SDK). */
export async function enumerateSessions(root: string, dirs: readonly string[]): Promise<Candidate[]> {
	const all = (await Promise.all(dirs.map((dir) => dirCandidates(root, dir)))).flat();
	all.sort((a, b) => b.mtime - a.mtime || greaterIdFirst(a.sessionId, b.sessionId));
	const seen = new Set<string>();
	return all.filter((candidate) => {
		const duplicate = seen.has(candidate.sessionId);
		seen.add(candidate.sessionId);
		return !duplicate;
	});
}
