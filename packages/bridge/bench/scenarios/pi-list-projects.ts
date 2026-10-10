import * as pi from "../../src/connectors/pi";
import { getPiSessionListCacheStats } from "../../src/connectors/pi/pi-session-list-cache";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const startedAt = Date.now();
	const projects = await pi.listProjects();
	const wallMs = Date.now() - startedAt;
	const cache = getPiSessionListCacheStats();
	return {
		wallMs,
		projects: projects.length,
		withLastOpened: projects.filter((project) => (project.lastOpened ?? 0) > 0).length,
		cacheDirs: cache.dirs,
		cacheBytes: cache.bytes,
		rssBytes: process.memoryUsage.rss(),
	};
});
