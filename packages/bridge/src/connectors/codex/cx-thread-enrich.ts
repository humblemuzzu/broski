/**
 * Codex thread diff-stat enrichment.
 *
 * Resolving a thread to its rollout file goes through the SQLite index first (one batched query),
 * then a single filesystem head scan that is shared by every overlapping caller. Stats are computed
 * through a bounded pool, so a page of 100 MB+ rollouts cannot pull the process into the RSS cap.
 */

import type { CodexThread } from "../../types";
import { runPool } from "../../utils/bounded-pool";
import { singleFlight } from "../../utils/single-flight";
import { collectRolloutFiles, type RolloutRoots } from "./cx-rollout-files";
import { cachedRolloutHead } from "./cx-rollout-meta";
import { computeCxThreadStats } from "./cx-session-stats";
import { findRolloutPathsByIds } from "./cx-sqlite";

export const CX_STATS_CONCURRENCY = 4;

const PATH_SCAN_CONCURRENCY = 8;
const PATH_INDEX_TTL_MS = 30_000;

type PathIndex = { builtAt: number; byThreadId: Map<string, string> };

const pathIndexes = new Map<string, PathIndex>();
const pathScansInFlight = new Map<string, Promise<Map<string, string>>>();

async function scanRolloutThreadIds(roots?: RolloutRoots): Promise<Map<string, string>> {
	const files = await collectRolloutFiles(roots);
	const byThreadId = new Map<string, string>();
	await runPool(files, PATH_SCAN_CONCURRENCY, async (filePath) => {
		const head = await cachedRolloutHead(filePath);
		if (head?.id && !byThreadId.has(head.id)) byThreadId.set(head.id, filePath);
	});
	return byThreadId;
}

async function rolloutPathIndex(roots?: RolloutRoots): Promise<Map<string, string>> {
	const key = roots?.sessionsDir ?? "default";
	const cached = pathIndexes.get(key);
	if (cached && Date.now() - cached.builtAt < PATH_INDEX_TTL_MS) return cached.byThreadId;
	return singleFlight(pathScansInFlight, key, async () => {
		const byThreadId = await scanRolloutThreadIds(roots);
		pathIndexes.set(key, { builtAt: Date.now(), byThreadId });
		return byThreadId;
	});
}

/** Resolve thread ids to rollout paths, using the SQLite index before the filesystem scan. */
export async function resolveRolloutPaths(threadIds: string[], roots?: RolloutRoots): Promise<Map<string, string>> {
	const resolved = findRolloutPathsByIds(threadIds);
	const missing = threadIds.filter((id) => !resolved.has(id));
	if (missing.length === 0) return resolved;

	const index = await rolloutPathIndex(roots);
	for (const id of missing) {
		const filePath = index.get(id);
		if (filePath) resolved.set(id, filePath);
	}
	return resolved;
}

/** Enrich threads that have no summary yet, at most `concurrency` rollouts in flight. */
export async function enrichThreadsWithStats(
	threads: CodexThread[],
	options: { roots?: RolloutRoots; concurrency?: number } = {},
): Promise<void> {
	const needStats = threads.filter((thread) => !thread.summary);
	if (needStats.length === 0) return;

	const resolved = await resolveRolloutPaths(
		needStats.map((thread) => thread.id),
		options.roots,
	);

	await runPool(needStats, options.concurrency ?? CX_STATS_CONCURRENCY, async (thread) => {
		const filePath = resolved.get(thread.id);
		if (!filePath) return;
		const summary = await computeCxThreadStats(filePath, thread.id);
		if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
			thread.summary = summary;
		}
	});
}
