import { findCodexStateDbPath, listThreadsFromDb } from "../../src/connectors/codex/cx-sqlite";
import { enrichThreadsWithStats } from "../../src/connectors/codex-fs";
import { runScenario } from "../lib/report";

const THREADS = 200;

await runScenario(async () => {
	const dbPath = findCodexStateDbPath();
	if (!dbPath) return { dbPath: "missing" };

	const listStart = Date.now();
	const threads = listThreadsFromDb({ limit: THREADS, sortKey: "updated_at" }, dbPath);
	const listMs = Date.now() - listStart;

	const enrichStart = Date.now();
	await enrichThreadsWithStats(threads);
	const enrichMs = Date.now() - enrichStart;

	return {
		listMs,
		threads: threads.length,
		enrichMs,
		withSummary: threads.filter((thread) => thread.summary).length,
		rssBytes: process.memoryUsage.rss(),
	};
});
