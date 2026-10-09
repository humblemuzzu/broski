import type { SessionDiffSummary } from "../../handlers/session-stats";
import type { PiSessionInfo } from "../../types/pi";
import { runPool } from "../../utils/bounded-pool";
import { computePiSessionStats, countSubagentTools } from "./pi-session-stats";

export type PiSessionStatsScan = (filePath: string) => Promise<{
	summary: SessionDiffSummary | null;
	toolCount: number;
}>;

/** A heavily used machine holds thousands of sessions; scanning them all at once exhausts memory. */
export const PI_STATS_SCAN_CONCURRENCY = 4;

async function scanSessionStats(filePath: string): Promise<{ summary: SessionDiffSummary | null; toolCount: number }> {
	const [summary, toolCount] = await Promise.all([computePiSessionStats(filePath), countSubagentTools(filePath)]);
	return { summary, toolCount };
}

/** Enrich a list of Pi sessions with diff stats and subagent tool counts (cached by mtime). */
export async function enrichPiSessionsWithStats(
	sessions: PiSessionInfo[],
	scan: PiSessionStatsScan = scanSessionStats,
	concurrency: number = PI_STATS_SCAN_CONCURRENCY,
): Promise<void> {
	const queue = sessions.filter((session) => session.path);

	await runPool(queue, concurrency, async (session) => {
		const { summary, toolCount } = await scan(session.path);
		if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
			session.summary = summary;
		}
		if (toolCount > 0) {
			session.subagentToolCount = toolCount;
		}
	});
}
