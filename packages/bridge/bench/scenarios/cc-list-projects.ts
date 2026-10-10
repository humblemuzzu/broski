import { listProjects } from "../../src/connectors/claude-code";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const startedAt = Date.now();
	const projects = await listProjects();
	const wallMs = Date.now() - startedAt;
	return {
		wallMs,
		count: projects.length,
		rssBytes: process.memoryUsage.rss(),
	};
});
