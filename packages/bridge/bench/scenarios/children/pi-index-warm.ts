/**
 * Builds the Pi session index into the cache directory named by `BROSKI_CACHE_DIR`.
 *
 * The warm-up half of `pi-list-sessions-restart`: the restart scenario measures a fresh process that
 * finds this index already on disk, so the build has to happen in a process of its own.
 */

import { listIndexedPiSessions } from "../../../src/connectors/pi/pi-session-list-indexed";
import { indexBytes } from "../../lib/index-file";
import { runScenario } from "../../lib/report";

await runScenario(async () => {
	const startedAtMs = performance.now();
	const sessions = await listIndexedPiSessions({ yieldBetweenFiles: false });
	return {
		callMs: Math.round(performance.now() - startedAtMs),
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagentTools: sessions.filter((session) => (session.subagentToolCount ?? 0) > 0).length,
		indexBytes: await indexBytes(),
		rssMb: Math.round(process.memoryUsage.rss() / 1024 ** 2),
	};
});
