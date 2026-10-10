import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pi from "../../src/connectors/pi";
import { runScenario } from "../lib/report";

process.env.BROSKI_CACHE_DIR = await mkdtemp(join(tmpdir(), "broski-pi-warm-"));

await runScenario(async () => {
	const firstStart = Date.now();
	const first = await pi.listSessions();
	const firstMs = Date.now() - firstStart;

	const secondStart = Date.now();
	const second = await pi.listSessions();
	const secondMs = Date.now() - secondStart;

	return {
		firstMs,
		firstCount: first.length,
		secondMs,
		secondCount: second.length,
		speedup: secondMs > 0 ? Number((firstMs / secondMs).toFixed(1)) : 0,
		rssBytes: process.memoryUsage.rss(),
	};
});
