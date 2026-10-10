import { enrichSessionsWithStats, mapSessionInfo } from "../../src/connectors/pi/pi-session-info";
import { listAllSessionInfos } from "../../src/connectors/pi/pi-session-list-cache";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const listStart = Date.now();
	const infos = await listAllSessionInfos();
	const listMs = Date.now() - listStart;

	const sessions = infos.map(mapSessionInfo);
	const enrichStart = Date.now();
	await enrichSessionsWithStats(sessions);
	const enrichMs = Date.now() - enrichStart;

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
