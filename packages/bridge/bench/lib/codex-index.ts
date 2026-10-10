import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { findCodexStateDbPath } from "../../src/connectors/codex/cx-sqlite";

export type IndexedRollout = { id: string; rolloutPath: string; bytes: number };

export function listIndexedRollouts(dbPath?: string): IndexedRollout[] {
	const resolved = dbPath ?? findCodexStateDbPath();
	if (!resolved) return [];

	const db = new Database(resolved, { readonly: true });
	try {
		const rows = db.query("SELECT id, rollout_path FROM threads").all() as Array<{
			id: string;
			rollout_path: string;
		}>;
		const out: IndexedRollout[] = [];
		for (const row of rows) {
			if (!row.id || !row.rollout_path || !existsSync(row.rollout_path)) continue;
			try {
				out.push({ id: row.id, rolloutPath: row.rollout_path, bytes: statSync(row.rollout_path).size });
			} catch {}
		}
		return out;
	} finally {
		db.close();
	}
}

export function largestIndexedRollout(rollouts: IndexedRollout[]): IndexedRollout | null {
	let best: IndexedRollout | null = null;
	for (const rollout of rollouts) {
		if (!best || rollout.bytes > best.bytes) best = rollout;
	}
	return best;
}
