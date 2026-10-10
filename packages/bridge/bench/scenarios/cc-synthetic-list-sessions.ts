/**
 * Synthetic Claude Code session listing: 2000 sessions plus one 300 MB transcript, written under a
 * temp dir that is deleted afterwards. Reports the new streamed/cached path cold and warm next to
 * the whole-file implementation it replaced, on identical fixtures.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessionsFromProjects } from "../../src/connectors/claude-code/cc-session-list";
import { buildTranscriptMessages } from "../../src/connectors/claude-code/cc-transcript";
import { legacyListSessions } from "../lib/cc-legacy-oracle";
import { legacyGetSessionMessages } from "../lib/cc-legacy-transcript-oracle";
import { buildSyntheticProjects } from "../lib/cc-synthetic-fixtures";
import { runScenario } from "../lib/report";

const PROJECTS = 20;
const SESSIONS_PER_PROJECT = 100;
const LARGE_TRANSCRIPT_BYTES = 300 * 1024 * 1024;
const TRANSCRIPT_LIMIT = 200;

await runScenario(async () => {
	const root = await mkdtemp(join(tmpdir(), "broski-bench-cc-sessions-"));
	const projectsDir = join(root, "projects");
	try {
		const fixture = await buildSyntheticProjects(projectsDir, {
			projects: PROJECTS,
			sessionsPerProject: SESSIONS_PER_PROJECT,
			cwdPrefix: join(root, "work"),
			turnsPerSession: 3,
			subagentsPerSession: 1,
			orphanSubagentDirs: 1,
			largeTranscriptBytes: LARGE_TRANSCRIPT_BYTES,
		});

		Bun.gc(true);
		const rssBeforeBytes = process.memoryUsage.rss();

		const coldStart = Date.now();
		const cold = await listSessionsFromProjects(undefined, projectsDir);
		const coldMs = Date.now() - coldStart;

		Bun.gc(true);
		const rssAfterColdBytes = process.memoryUsage.rss();

		const warmStart = Date.now();
		const warm = await listSessionsFromProjects(undefined, projectsDir);
		const warmMs = Date.now() - warmStart;

		Bun.gc(true);
		const rssAfterWarmBytes = process.memoryUsage.rss();

		const legacyStart = Date.now();
		const legacy = await legacyListSessions(undefined, projectsDir);
		const legacyMs = Date.now() - legacyStart;

		Bun.gc(true);
		const rssAfterLegacyBytes = process.memoryUsage.rss();

		const largePath = fixture.largeTranscriptPath;
		if (!largePath) throw new Error("large transcript fixture was not written");

		Bun.gc(true);
		const rssBeforeTailBytes = process.memoryUsage.rss();
		const tailStart = Date.now();
		const tailed = await buildTranscriptMessages(largePath, TRANSCRIPT_LIMIT);
		const tailMs = Date.now() - tailStart;

		Bun.gc(true);
		const rssAfterTailBytes = process.memoryUsage.rss();
		const legacyReadStart = Date.now();
		const legacyRead = await legacyGetSessionMessages(largePath, TRANSCRIPT_LIMIT);
		const legacyReadMs = Date.now() - legacyReadStart;

		Bun.gc(true);
		const rssAfterLegacyReadBytes = process.memoryUsage.rss();

		return {
			fixtureBytes: fixture.bytes,
			largeTranscriptBytes: fixture.largeTranscriptBytes,
			coldMs,
			coldCount: cold.length,
			coldWithSummary: cold.filter((s) => s.summary).length,
			warmMs,
			warmCount: warm.length,
			legacyMs,
			legacyCount: legacy.length,
			legacyWithSummary: legacy.filter((s) => s.summary).length,
			coldSpeedup: Number((legacyMs / Math.max(coldMs, 1)).toFixed(2)),
			warmSpeedup: Number((legacyMs / Math.max(warmMs, 1)).toFixed(2)),
			rssBeforeMb: Math.round(rssBeforeBytes / 1048576),
			coldRssDeltaMb: Math.round((rssAfterColdBytes - rssBeforeBytes) / 1048576),
			warmRssDeltaMb: Math.round((rssAfterWarmBytes - rssAfterColdBytes) / 1048576),
			legacyRssDeltaMb: Math.round((rssAfterLegacyBytes - rssAfterWarmBytes) / 1048576),
			tailMs,
			tailMessages: tailed.length,
			legacyReadMs,
			legacyReadMessages: legacyRead.length,
			transcriptMatch: Bun.deepEquals(tailed, legacyRead),
			tailRssDeltaMb: Math.round((rssAfterTailBytes - rssBeforeTailBytes) / 1048576),
			legacyReadRssDeltaMb: Math.round((rssAfterLegacyReadBytes - rssAfterTailBytes) / 1048576),
			rssBytes: process.memoryUsage.rss(),
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
