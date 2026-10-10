import { listSessions } from "../../src/connectors/claude-code";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const startedAt = Date.now();
	const sessions = await listSessions();
	const wallMs = Date.now() - startedAt;
	return {
		wallMs,
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagents: sessions.filter((session) => (session.subagentCount ?? 0) > 0).length,
		rssBytes: process.memoryUsage.rss(),
	};
});
