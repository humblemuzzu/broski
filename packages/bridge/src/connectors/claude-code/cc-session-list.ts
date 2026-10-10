/**
 * Claude Code session listing.
 *
 * Extracted from claude-code.ts (frozen file). Previews come from the fingerprint-cached preview
 * reader, diff stats are streamed through a bounded pool, and concurrent calls for the same cwd
 * share one run. Sessions are scanned through a bounded pool whose results are flattened in file
 * order, so the listing is identical to the serial scan without one `await` per file.
 */

import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ClaudeCodeSession } from "../../types";
import { runPool } from "../../utils/bounded-pool";
import { singleFlight } from "../../utils/single-flight";
import { getProjectSessionsDir } from "./cc-paths";
import { readSessionPreviewCached } from "./cc-session-preview";
import { computeCCSessionStats } from "./cc-session-stats";
import { scanSubagentDir } from "./cc-subagent-scan";

/** Heavily used machines hold thousands of sessions; scanning them all at once exhausts memory. */
export const CC_PREVIEW_SCAN_CONCURRENCY = 16;
/** Previews read at most 200 KB each; diff stats stream whole transcripts, so keep those at 4. */
export const CC_STATS_SCAN_CONCURRENCY = 4;

type SessionWithFile = ClaudeCodeSession & { _filePath?: string };

type SessionUnit = {
	parent: SessionWithFile | null;
	subagents: ClaudeCodeSession[];
	failure?: boolean;
};

const FILTERED_UNIT: SessionUnit = { parent: null, subagents: [] };
const FAILED_UNIT: SessionUnit = { parent: null, subagents: [], failure: true };

const listInFlight = new Map<string, Promise<ClaudeCodeSession[]>>();

export function listSessionsFromProjects(cwd: string | undefined, projectsDir: string): Promise<ClaudeCodeSession[]> {
	return singleFlight(listInFlight, `${projectsDir}\u0000${cwd ?? ""}`, () => collectSessions(cwd, projectsDir));
}

async function attachSessionStats(sessions: SessionWithFile[]): Promise<void> {
	await runPool(sessions, CC_STATS_SCAN_CONCURRENCY, async (session) => {
		const filePath = session._filePath;
		if (!filePath) return;
		const summary = await computeCCSessionStats(filePath);
		if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
			session.summary = summary;
		}
		delete session._filePath;
	});
}

async function collectSessions(cwd: string | undefined, projectsDir: string): Promise<ClaudeCodeSession[]> {
	const sessions: SessionWithFile[] = [];

	try {
		let projectDirs: string[] = [];

		if (cwd) {
			const projectDir = await getProjectSessionsDir(cwd, projectsDir);
			try {
				await stat(projectDir);
				projectDirs = [projectDir];
			} catch {
				return [];
			}
		} else {
			try {
				const entries = await readdir(projectsDir, { withFileTypes: true });
				projectDirs = entries.filter((e) => e.isDirectory()).map((e) => join(projectsDir, e.name));
			} catch {
				return [];
			}
		}

		for (const projectDir of projectDirs) {
			try {
				const files = await readdir(projectDir);
				const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
				const sessionIdsWithJsonl = new Set(sessionFiles.map((f) => basename(f, ".jsonl")));

				await collectProjectSessions(projectDir, sessionFiles, cwd, sessions);

				// Also scan for orphaned subagent directories (sessions archived/compacted with no .jsonl)
				const allDirs = files.filter((f) => !f.endsWith(".jsonl") && !f.endsWith("index.json") && !f.endsWith(".json"));
				for (const dirName of allDirs) {
					if (sessionIdsWithJsonl.has(dirName)) continue; // already processed above
					await scanSubagentDir(projectDir, dirName, cwd ?? "", cwd, sessions, readSessionPreviewCached);
				}
			} catch {}
		}

		sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		await attachSessionStats(sessions);

		return sessions;
	} catch {
		return [];
	}
}

async function collectProjectSessions(
	projectDir: string,
	sessionFiles: string[],
	cwd: string | undefined,
	sessions: SessionWithFile[],
): Promise<void> {
	const units: SessionUnit[] = new Array(sessionFiles.length).fill(FILTERED_UNIT);

	await runPool(
		sessionFiles.map((file, index) => ({ file, index })),
		CC_PREVIEW_SCAN_CONCURRENCY,
		async ({ file, index }) => {
			units[index] = await collectSessionUnit(projectDir, file, cwd);
		},
	);

	// A file that cannot be stat'ed ends the serial scan it replaced, so everything after it in
	// this directory stays out of the listing.
	for (const unit of units) {
		if (unit.failure) return;
		if (unit.parent) sessions.push(unit.parent);
		for (const subagent of unit.subagents) sessions.push(subagent);
	}
}

async function collectSessionUnit(projectDir: string, file: string, cwd: string | undefined): Promise<SessionUnit> {
	const sessionId = basename(file, ".jsonl");
	const filePath = join(projectDir, file);

	try {
		const fileStat = await stat(filePath);
		const preview = await readSessionPreviewCached(filePath);
		const sessionCwd = preview.cwd ?? cwd ?? "";

		// Filter if caller requested a specific cwd but directory encoding collided.
		if (cwd && sessionCwd && sessionCwd !== cwd) {
			return FILTERED_UNIT;
		}

		const derivedTitle =
			preview.title || preview.slug || (sessionCwd ? `${basename(sessionCwd)} • ${sessionId.slice(0, 8)}` : undefined);

		const parent: SessionWithFile = {
			id: sessionId,
			title: derivedTitle || `Session ${sessionId.slice(0, 8)}`,
			cwd: sessionCwd || cwd || "",
			model: preview.model,
			createdAt: fileStat.birthtime.getTime(),
			updatedAt: fileStat.mtime.getTime(),
			isBackground: preview.isBackground,
			hasSubagentActivity: preview.hasSubagentActivity,
			subagentName: preview.subagentName,
			gitBranch: preview.gitBranch,
			_filePath: filePath,
		};

		const subagents: ClaudeCodeSession[] = [];
		const subagentCount = await scanSubagentDir(
			projectDir,
			sessionId,
			sessionCwd,
			cwd,
			subagents,
			readSessionPreviewCached,
		);
		if (subagentCount > 0) parent.subagentCount = subagentCount;

		return { parent, subagents };
	} catch {
		return FAILED_UNIT;
	}
}
