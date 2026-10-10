import { resolve } from "node:path";
import type { CxProjectCacheEntry, CxThreadCacheEntry } from "../routing/types";

// Codex caching for fast session/project loading (mirrors OpenCode's 5s TTL pattern);
// projects rarely change, so they get a longer TTL.
export const CODEX_THREAD_CACHE_TTL_MS = 5000;
export const CODEX_PROJECT_CACHE_TTL_MS = 30000;

export type CodexCaches = {
	threadCache: Map<string, CxThreadCacheEntry>;
	getProjectCache: () => CxProjectCacheEntry | null;
	setProjectCache: (cache: CxProjectCacheEntry | null) => void;
	invalidate: (cwd?: string) => void;
	threadTtlMs: number;
	projectTtlMs: number;
};

export function createCodexCaches(): CodexCaches {
	const threadCache = new Map<string, CxThreadCacheEntry>();
	let projectCache: CxProjectCacheEntry | null = null;

	const invalidate = (cwd?: string): void => {
		// Always invalidate project cache on any mutation
		projectCache = null;
		if (cwd) {
			threadCache.delete(cwd);
			threadCache.delete(resolve(cwd));
		}
		threadCache.delete("__all__");
	};

	return {
		threadCache,
		getProjectCache: () => projectCache,
		setProjectCache: (cache) => {
			projectCache = cache;
		},
		invalidate,
		threadTtlMs: CODEX_THREAD_CACHE_TTL_MS,
		projectTtlMs: CODEX_PROJECT_CACHE_TTL_MS,
	};
}
