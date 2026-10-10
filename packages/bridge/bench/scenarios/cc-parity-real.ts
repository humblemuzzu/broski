/**
 * Parity check against the real (read-only) `~/.claude` data: the new streamed, cached read paths
 * must return byte-identical results to the whole-file implementations they replaced. Every file is
 * only read; nothing under `~/.claude` is written.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_PROJECTS_DIR } from "../../src/connectors/claude-code/cc-paths";
import { listProjectsFromClaudeDirs } from "../../src/connectors/claude-code/cc-project-list";
import { listSessionsFromProjects } from "../../src/connectors/claude-code/cc-session-list";
import { readSessionPreview } from "../../src/connectors/claude-code/cc-session-preview";
import { computeCCSessionStats } from "../../src/connectors/claude-code/cc-session-stats";
import { buildTranscriptMessages } from "../../src/connectors/claude-code/cc-transcript";
import { legacyComputeCCSessionStats, legacyListSessions, legacyReadSessionPreview } from "../lib/cc-legacy-oracle";
import { legacyListProjects } from "../lib/cc-legacy-projects-oracle";
import { legacyGetSessionMessages } from "../lib/cc-legacy-transcript-oracle";
import { runScenario } from "../lib/report";

const LIMITS = [1, 5, 50, 200];

async function listRealSessionFiles(): Promise<string[]> {
	const out: string[] = [];
	let projects: string[];
	try {
		projects = (await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(CLAUDE_PROJECTS_DIR, entry.name));
	} catch {
		return out;
	}
	for (const project of projects) {
		for (const name of await readdir(project).catch(() => [] as string[])) {
			if (name.endsWith(".jsonl")) out.push(join(project, name));
		}
	}
	return out.sort();
}

async function largest(files: string[]): Promise<string | null> {
	let best: { path: string; bytes: number } | null = null;
	for (const file of files) {
		const info = await stat(file).catch(() => null);
		if (!info) continue;
		if (!best || info.size > best.bytes) best = { path: file, bytes: info.size };
	}
	return best?.path ?? null;
}

await runScenario(async () => {
	const files = await listRealSessionFiles();
	const home = homedir();

	let previewMismatches = 0;
	let statsMismatches = 0;
	const previewStart = Date.now();
	for (const file of files) {
		if (!Bun.deepEquals(await readSessionPreview(file), await legacyReadSessionPreview(file))) previewMismatches++;
		if (!Bun.deepEquals(await computeCCSessionStats(file), await legacyComputeCCSessionStats(file))) statsMismatches++;
	}
	const perFileNewMs = Date.now() - previewStart;

	const sessionsStart = Date.now();
	const sessions = await listSessionsFromProjects(undefined, CLAUDE_PROJECTS_DIR);
	const sessionsMs = Date.now() - sessionsStart;
	const legacySessionsStart = Date.now();
	const legacySessions = await legacyListSessions(undefined, CLAUDE_PROJECTS_DIR);
	const legacySessionsMs = Date.now() - legacySessionsStart;

	const projectsStart = Date.now();
	const projects = await listProjectsFromClaudeDirs({ projectsDir: CLAUDE_PROJECTS_DIR, home });
	const projectsMs = Date.now() - projectsStart;
	const legacyProjectsStart = Date.now();
	const legacyProjects = await legacyListProjects(CLAUDE_PROJECTS_DIR, home);
	const legacyProjectsMs = Date.now() - legacyProjectsStart;

	const target = await largest(files);
	let transcriptMismatches = 0;
	let transcriptLimit = 0;
	let transcriptBytes = 0;
	let newReadMs = 0;
	let legacyReadMs = 0;
	if (target) {
		transcriptBytes = (await stat(target)).size;
		for (const limit of LIMITS) {
			const actual = await buildTranscriptMessages(target, limit);
			const expected = await legacyGetSessionMessages(target, limit);
			if (!Bun.deepEquals(actual, expected)) transcriptMismatches++;
			else transcriptLimit = actual.length;
		}
		const readLimit = LIMITS[LIMITS.length - 1] ?? 200;
		const newStart = Date.now();
		await buildTranscriptMessages(target, readLimit);
		newReadMs = Date.now() - newStart;
		const legacyStart = Date.now();
		await legacyGetSessionMessages(target, readLimit);
		legacyReadMs = Date.now() - legacyStart;
	}

	return {
		files: files.length,
		previewMismatches,
		statsMismatches,
		sessions: sessions.length,
		legacySessions: legacySessions.length,
		sessionsMatch: Bun.deepEquals(sessions, legacySessions),
		projects: projects.length,
		legacyProjects: legacyProjects.length,
		projectsMatch: Bun.deepEquals(projects, legacyProjects),
		transcriptBytes,
		transcriptMismatches,
		transcriptMessagesAtSmallestLimit: transcriptLimit,
		newReadMs,
		legacyReadMs,
		perFileNewMs,
		sessionsMs,
		legacySessionsMs,
		projectsMs,
		legacyProjectsMs,
		rssBytes: process.memoryUsage.rss(),
	};
});
