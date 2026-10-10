/**
 * A Pi session listing in a process that starts with an empty index: the index is built from every
 * session file, which is what a bridge installs' first listing after the feature ships pays.
 *
 * `BROSKI_CACHE_DIR` points at a temp directory, so the run never touches the real cache.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BROSKI_CACHE_DIR = await mkdtemp(join(tmpdir(), "broski-pi-cold-"));

const { listIndexedPiSessions } = await import("../../src/connectors/pi/pi-session-list-indexed");
const { indexBytes } = await import("../lib/index-file");
const { runScenario } = await import("../lib/report");

await runScenario(async () => {
	const startedAtMs = performance.now();
	const sessions = await listIndexedPiSessions({ yieldBetweenFiles: false });
	return {
		wallMs: Math.round(performance.now() - startedAtMs),
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagentTools: sessions.filter((session) => (session.subagentToolCount ?? 0) > 0).length,
		indexBytes: await indexBytes(),
		rssBytes: process.memoryUsage.rss(),
	};
});
