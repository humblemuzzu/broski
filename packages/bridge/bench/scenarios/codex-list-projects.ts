import { findCodexStateDbPath, listProjectsFromDb } from "../../src/connectors/codex/cx-sqlite";
import { listProjectsFromFs } from "../../src/connectors/codex-fs";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const fsStart = Date.now();
	let projects = await listProjectsFromFs();
	const fsMs = Date.now() - fsStart;
	const fsCount = projects.length;

	let sqliteMs = 0;
	let source = "fs";
	if (projects.length === 0) {
		const dbPath = findCodexStateDbPath();
		if (dbPath) {
			const sqliteStart = Date.now();
			projects = listProjectsFromDb(dbPath);
			sqliteMs = Date.now() - sqliteStart;
			source = "sqlite";
		}
	}

	return {
		fsMs,
		fsCount,
		sqliteMs,
		count: projects.length,
		source,
		rssBytes: process.memoryUsage.rss(),
	};
});
