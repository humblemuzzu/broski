/**
 * Measures one Pi session listing in a fresh process whose index is already on disk.
 *
 * Everything the process does before the call — bun boot, module load — is outside `callMs`, which is
 * what the phone waits for after a bridge restart.
 */

import { listIndexedPiSessions } from "../../../src/connectors/pi/pi-session-list-indexed";
import { indexBytes, indexEntries } from "../../lib/index-file";
import { runScenario } from "../../lib/report";

await runScenario(async () => {
	const startedAtMs = performance.now();
	const sessions = await listIndexedPiSessions({ yieldBetweenFiles: false });
	const callMs = Math.round(performance.now() - startedAtMs);
	return {
		callMs,
		count: sessions.length,
		withSummary: sessions.filter((session) => session.summary).length,
		withSubagentTools: sessions.filter((session) => (session.subagentToolCount ?? 0) > 0).length,
		indexBytes: await indexBytes(),
		indexEntries: await indexEntries(),
		rssMb: Math.round(process.memoryUsage.rss() / 1024 ** 2),
	};
});
