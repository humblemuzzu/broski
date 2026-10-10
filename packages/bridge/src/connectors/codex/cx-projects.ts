/**
 * Project list derived from rollout files.
 *
 * Only the `session_meta` head of each rollout is read, through a bounded pool, so the filesystem
 * fallback costs one small read per file instead of a whole-tree read.
 */

import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ProjectSummary } from "../../types";
import { runPool } from "../../utils/bounded-pool";
import { collectRolloutFiles, type RolloutRoots } from "./cx-rollout-files";
import { cachedRolloutHead } from "./cx-rollout-meta";

const PROJECT_SCAN_CONCURRENCY = 8;

type ProjectCandidate = { path: string; name: string; lastOpened: number };

async function mtimeSeconds(filePath: string): Promise<number | null> {
	try {
		const info = await stat(filePath);
		return Math.floor(info.mtime.getTime() / 1000);
	} catch {
		return null;
	}
}

/** List all unique projects from Codex sessions. */
export async function listProjectsFromFs(roots?: RolloutRoots): Promise<ProjectSummary[]> {
	const files = await collectRolloutFiles(roots);
	const byPath = new Map<string, ProjectCandidate>();

	await runPool(files, PROJECT_SCAN_CONCURRENCY, async (filePath) => {
		const [lastOpened, head] = await Promise.all([mtimeSeconds(filePath), cachedRolloutHead(filePath)]);
		if (lastOpened === null || !head?.cwd) return;

		const path = resolve(head.cwd);
		const existing = byPath.get(path);
		if (!existing || lastOpened > existing.lastOpened) {
			byPath.set(path, { path, name: basename(path) || path, lastOpened });
		}
	});

	return Array.from(byPath.values())
		.sort((a, b) => b.lastOpened - a.lastOpened)
		.map((project) => ({
			id: project.path,
			name: project.name,
			path: project.path,
			lastOpened: project.lastOpened,
		}));
}
