/**
 * Where on-disk index caches live.
 *
 * `~/.broski/cache` by default. An explicit root wins over `BROSKI_CACHE_DIR`, which wins over the
 * default, so a test or a bench run can point at a temp directory instead of the real one.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertNotRealHome } from "../safety/real-home-guard";

export const INDEX_CACHE_DIR_ENV = "BROSKI_CACHE_DIR";

export function resolveIndexCacheRoot(explicit?: string): string {
	const fromArgument = explicit?.trim();
	if (fromArgument) return resolve(fromArgument);

	const fromEnv = process.env[INDEX_CACHE_DIR_ENV]?.trim();
	if (fromEnv) return resolve(fromEnv);

	const defaultRoot = resolve(homedir(), ".broski", "cache");
	assertNotRealHome(defaultRoot, "index cache root");
	return defaultRoot;
}

export function indexCacheFilePath(name: string, root?: string): string {
	return join(resolveIndexCacheRoot(root), name);
}
