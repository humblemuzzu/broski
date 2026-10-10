import * as pi from "../../src/connectors/pi";
import { getPiSessionListCacheStats } from "../../src/connectors/pi/pi-session-list-cache";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const firstStart = Date.now();
	const first = await pi.listSessions();
	const firstMs = Date.now() - firstStart;
	const firstCache = getPiSessionListCacheStats();

	const secondStart = Date.now();
	const second = await pi.listSessions();
	const secondMs = Date.now() - secondStart;
	const secondCache = getPiSessionListCacheStats();

	return {
		firstMs,
		firstCount: first.length,
		firstCacheBytes: firstCache.bytes,
		secondMs,
		secondCount: second.length,
		secondCacheBytes: secondCache.bytes,
		speedup: firstMs > 0 ? Number((firstMs / Math.max(secondMs, 1)).toFixed(2)) : 0,
		rssBytes: process.memoryUsage.rss(),
	};
});
