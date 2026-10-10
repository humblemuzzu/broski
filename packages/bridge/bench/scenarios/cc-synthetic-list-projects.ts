/**
 * Synthetic Claude Code project listing: a fake home tree of nested repos, half of them with the
 * `.claude/settings*.json` that makes them real projects. Reports the new TTL-cached walk cold and
 * warm next to the uncached walk it replaced.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectsFromClaudeDirs } from "../../src/connectors/claude-code/cc-project-list";
import { legacyListProjects } from "../lib/cc-legacy-projects-oracle";
import { buildSyntheticHome } from "../lib/cc-synthetic-fixtures";
import { runScenario } from "../lib/report";

const AREAS = 10;
const REPOS_PER_AREA = 10;

await runScenario(async () => {
	const root = await mkdtemp(join(tmpdir(), "broski-bench-cc-projects-"));
	const home = join(root, "home");
	const projectsDir = join(root, "projects");
	try {
		await mkdir(projectsDir, { recursive: true });
		const fixture = await buildSyntheticHome(home, {
			areas: AREAS,
			reposPerArea: REPOS_PER_AREA,
			fillerDirsPerRepo: 4,
			unverifiedPerRepo: 2,
		});

		const coldStart = Date.now();
		const cold = await listProjectsFromClaudeDirs({ projectsDir, home });
		const coldMs = Date.now() - coldStart;

		const warmStart = Date.now();
		const warm = await listProjectsFromClaudeDirs({ projectsDir, home });
		const warmMs = Date.now() - warmStart;

		Bun.gc(true);
		const rssBeforeLegacyBytes = process.memoryUsage.rss();
		const legacyStart = Date.now();
		const legacy = await legacyListProjects(projectsDir, home);
		const legacyMs = Date.now() - legacyStart;

		return {
			dirs: fixture.dirs,
			projects: fixture.projects,
			coldMs,
			coldCount: cold.length,
			warmMs,
			warmCount: warm.length,
			legacyMs,
			legacyCount: legacy.length,
			coldSpeedup: Number((legacyMs / Math.max(coldMs, 1)).toFixed(2)),
			warmSpeedup: Number((legacyMs / Math.max(warmMs, 1)).toFixed(2)),
			legacyRssDeltaMb: Math.round((process.memoryUsage.rss() - rssBeforeLegacyBytes) / 1048576),
			rssBytes: process.memoryUsage.rss(),
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
