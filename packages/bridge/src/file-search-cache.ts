/**
 * Project scan cache for the file search module: one entry per resolved cwd.
 *
 * The hit/miss counters exist so cache behavior can be asserted directly
 * instead of inferring it from wall-clock timings.
 */

import { BoundedMap, registerSweepable } from "./state/bounded-map";

export type CachedProject = {
	files: string[];
	dirs: string[];
	fetchedAt: number;
};

export type FileSearchCacheStats = {
	entries: number;
	hits: number;
	misses: number;
};

const CACHE_TTL_MS = 30_000; // 30 seconds
/** A project's file listing is large; only a handful of recently searched ones are worth keeping. */
const CACHE_MAX_ENTRIES = 8;

const projectCache = new BoundedMap<string, CachedProject>({
	maxEntries: CACHE_MAX_ENTRIES,
	ttlMs: CACHE_TTL_MS,
	touchOnGet: false,
});

registerSweepable({
	name: "file-search-projects",
	sweep: (now) => projectCache.sweep(now),
	size: () => projectCache.size,
	limit: () => CACHE_MAX_ENTRIES,
});

let hits = 0;
let misses = 0;

export function getCachedProject(cwd: string): CachedProject | null {
	const entry = projectCache.get(cwd);
	if (!entry) {
		misses++;
		return null;
	}

	hits++;
	return entry;
}

export function setCachedProject(cwd: string, files: string[], dirs: string[]): void {
	projectCache.set(cwd, { files, dirs, fetchedAt: Date.now() });
}

export function invalidateCache(cwd?: string): void {
	if (cwd) {
		projectCache.delete(cwd);
	} else {
		projectCache.clear();
	}
}

export function getCacheStats(): FileSearchCacheStats {
	return { entries: projectCache.size, hits, misses };
}

export function resetCacheStats(): void {
	hits = 0;
	misses = 0;
}
