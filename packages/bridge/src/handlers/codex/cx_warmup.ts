/**
 * `cx_warmup` cache prefetch.
 *
 * Warms the SQLite-backed project and thread lists (what the phone renders first) plus the diff
 * stats of that first page. No whole-tree filesystem scan: 1082 rollout files is what made warmup
 * a second copy of the 4 s / 1.8 GiB project listing.
 */

import type { CodexThread, ProjectSummary } from "../../types";

export const CX_WARMUP_PAGE_LIMIT = 200;

export type CxWarmupSources = {
	findDbPath: () => string | null;
	listProjectsFromDb: (dbPath: string) => ProjectSummary[];
	listThreadsFromDb: (dbPath: string) => CodexThread[];
	listProjectsFromFs: () => Promise<ProjectSummary[]>;
	listThreadsFromFs: (cwd?: string) => Promise<CodexThread[]>;
	enrichThreadsWithStats: (threads: CodexThread[]) => Promise<void>;
	setProjectCache: (projects: ProjectSummary[]) => void;
	setThreadCache: (key: string, threads: CodexThread[]) => void;
	logInfo: (message: string) => void;
	logError: (message: string, ...args: unknown[]) => void;
};

async function warmLists(sources: CxWarmupSources): Promise<{ projects: ProjectSummary[]; threads: CodexThread[] }> {
	const dbPath = sources.findDbPath();
	if (dbPath) {
		// A database locked by a running Codex, or one whose schema moved on, is a reason to read the
		// rollout tree, not to abandon the warmup.
		try {
			const projects = sources.listProjectsFromDb(dbPath);
			const threads = sources.listThreadsFromDb(dbPath);
			if (projects.length > 0 && threads.length > 0) return { projects, threads };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sources.logInfo(`[cx_warmup] SQLite index unavailable: ${message}`);
		}
	}

	sources.logInfo("[cx_warmup] Reading rollout heads");
	return {
		projects: await sources.listProjectsFromFs(),
		threads: await sources.listThreadsFromFs(),
	};
}

/** Pre-populate the project and thread caches; returns the number of warmed threads. */
export async function warmCxCaches(
	sources: CxWarmupSources,
	pageLimit: number = CX_WARMUP_PAGE_LIMIT,
): Promise<number> {
	try {
		const { projects, threads } = await warmLists(sources);
		sources.setProjectCache(projects);
		sources.setThreadCache("__all__", threads);
		sources.logInfo(`[cx_warmup] Pre-cached ${projects.length} projects and ${threads.length} threads`);

		const page = threads.slice(0, pageLimit);
		await sources.enrichThreadsWithStats(page);
		sources.logInfo(`[cx_warmup] Pre-fetched diff stats for ${page.length} threads`);
		return threads.length;
	} catch (error) {
		sources.logError("[cx_warmup] Error:", error);
		return 0;
	}
}
