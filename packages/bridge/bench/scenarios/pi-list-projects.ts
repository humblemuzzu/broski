import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pi from "../../src/connectors/pi";
import { runScenario } from "../lib/report";

process.env.BROSKI_CACHE_DIR = await mkdtemp(join(tmpdir(), "broski-pi-projects-"));

await runScenario(async () => {
	const startedAt = Date.now();
	const projects = await pi.listProjects();
	const wallMs = Date.now() - startedAt;
	return {
		wallMs,
		projects: projects.length,
		withLastOpened: projects.filter((project) => (project.lastOpened ?? 0) > 0).length,
		rssBytes: process.memoryUsage.rss(),
	};
});
