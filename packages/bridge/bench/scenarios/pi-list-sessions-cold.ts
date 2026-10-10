import * as pi from "../../src/connectors/pi";
import { getPiSessionListCacheStats } from "../../src/connectors/pi/pi-session-list-cache";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const startedAt = Date.now();
	const sessions = await pi.listSessions();
	const wallMs = Date.now() - startedAt;
	const cache = getPiSessionListCacheStats();
	return {
		wallMs,
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagentTools: sessions.filter((session) => (session.subagentToolCount ?? 0) > 0).length,
		cacheDirs: cache.dirs,
		cacheBytes: cache.bytes,
		rssBytes: process.memoryUsage.rss(),
	};
});
