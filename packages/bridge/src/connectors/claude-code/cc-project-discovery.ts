/**
 * Recursive discovery of project directories that contain a `.claude/` folder.
 *
 * The walk covers the user's whole home tree to depth 5 and costs ~200 ms even on a small
 * machine, so its result is kept behind a TTL cache: inside the TTL the rows are served from
 * memory, past it the stale rows are served and a single background walk revalidates them.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ProjectSummary } from "../../types";
import { singleFlight } from "../../utils/single-flight";

export const CC_PROJECT_DISCOVERY_TTL_MS = 10 * 60 * 1000;

const SKIP_DIRS = ["node_modules", ".git", ".svn", "build", "dist", ".cache", ".Trash"];

type DiscoveryEntry = { at: number; value: ProjectSummary[] };

const discoveryCache = new Map<string, DiscoveryEntry>();
const discoveryInFlight = new Map<string, Promise<ProjectSummary[]>>();
const revalidating = new Set<string>();

export function clearCCProjectDiscoveryCache(): void {
	discoveryCache.clear();
}

function discoveryKey(roots: string[], maxDepth: number): string {
	return `${maxDepth}\u0000${roots.join("\u0001")}`;
}

function refresh(key: string, roots: string[], maxDepth: number): Promise<ProjectSummary[]> {
	return singleFlight(discoveryInFlight, key, async () => {
		const value = await walkProjects(roots, maxDepth);
		discoveryCache.set(key, { at: Date.now(), value });
		return value;
	});
}

export function discoverClaudeProjectsCached(roots: string[], maxDepth: number): Promise<ProjectSummary[]> {
	const key = discoveryKey(roots, maxDepth);
	const cached = discoveryCache.get(key);

	if (cached) {
		if (Date.now() - cached.at >= CC_PROJECT_DISCOVERY_TTL_MS && !revalidating.has(key)) {
			revalidating.add(key);
			void refresh(key, roots, maxDepth)
				.catch(() => {})
				.finally(() => revalidating.delete(key));
		}
		return Promise.resolve(cached.value);
	}

	return refresh(key, roots, maxDepth);
}

export async function walkProjects(roots: string[], maxDepth: number): Promise<ProjectSummary[]> {
	const seen = new Set<string>();
	const out: ProjectSummary[] = [];
	for (const root of roots) {
		try {
			await discoverClaudeProjects(root, 0, maxDepth, seen, out);
		} catch {
			// root doesn't exist or isn't readable – skip
		}
	}
	return out;
}

/**
 * Recursively scan a directory tree for folders containing `.claude/` with
 * `settings.local.json` or a sibling `CLAUDE.md` — indicators that Claude
 * Code was used in that project.  Skips node_modules, .git, etc.
 */
async function discoverClaudeProjects(
	dir: string,
	depth: number,
	maxDepth: number,
	seen: Set<string>,
	out: ProjectSummary[],
): Promise<void> {
	if (depth > maxDepth) return;

	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	if (SKIP_DIRS.includes(basename(dir))) return;

	const hasClaudeDir = entries.some((e) => e.isDirectory() && e.name === ".claude");
	if (hasClaudeDir && !seen.has(dir)) {
		// Only a local settings file proves the user actually ran Claude here; CLAUDE.md alone
		// doesn't count because cloned repos may include it.
		const claudeDir = join(dir, ".claude");
		const isRealProject = await Promise.all([
			stat(join(claudeDir, "settings.local.json")).catch(() => null),
			stat(join(claudeDir, "settings.json")).catch(() => null),
		]).then(([a, b]) => a || b);

		if (isRealProject) {
			seen.add(dir);
			const claudeSt = await stat(claudeDir).catch(() => null);
			out.push({
				id: dir,
				name: basename(dir),
				path: dir,
				lastOpened: claudeSt?.mtime?.getTime(),
			});
		}
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
		if (SKIP_DIRS.includes(entry.name)) continue;
		await discoverClaudeProjects(join(dir, entry.name), depth + 1, maxDepth, seen, out);
	}
}
