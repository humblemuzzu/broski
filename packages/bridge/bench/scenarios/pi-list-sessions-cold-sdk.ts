/**
 * The same listing through the SDK's own file reader, for the before/after comparison: an injected
 * `lister` forces `SessionManager.listAll`, which is what the bridge listed with before the index.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BROSKI_CACHE_DIR = await mkdtemp(join(tmpdir(), "broski-pi-cold-sdk-"));

const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { enrichSessionsWithStats, mapSessionInfo } = await import("../../src/connectors/pi/pi-session-info");
const { listAllSessionInfos } = await import("../../src/connectors/pi/pi-session-list-cache");
const { runScenario } = await import("../lib/report");

await runScenario(async () => {
	const listStart = performance.now();
	const infos = await listAllSessionInfos({ lister: (dir) => SessionManager.listAll(dir) });
	const listMs = Math.round(performance.now() - listStart);

	const sessions = infos.map(mapSessionInfo);
	const enrichStart = performance.now();
	await enrichSessionsWithStats(sessions);
	const enrichMs = Math.round(performance.now() - enrichStart);

	return {
		wallMs: listMs + enrichMs,
		listMs,
		enrichMs,
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagentTools: sessions.filter((session) => (session.subagentToolCount ?? 0) > 0).length,
		rssBytes: process.memoryUsage.rss(),
	};
});
