import { findCodexStateDbPath, listThreadsFromDb } from "../../src/connectors/codex/cx-sqlite";
import { runScenario } from "../lib/report";

const ALL_LIMIT = 100_000;

await runScenario(async () => {
	const dbPath = findCodexStateDbPath();
	if (!dbPath) return { dbPath: "missing" };

	const defaultStart = Date.now();
	const defaults = listThreadsFromDb({ sortKey: "updated_at" }, dbPath);
	const defaultMs = Date.now() - defaultStart;

	const allStart = Date.now();
	const all = listThreadsFromDb({ limit: ALL_LIMIT, sortKey: "updated_at" }, dbPath);
	const allMs = Date.now() - allStart;

	return {
		dbPath,
		defaultMs,
		defaultCount: defaults.length,
		allMs,
		allCount: all.length,
		rssBytes: process.memoryUsage.rss(),
	};
});
