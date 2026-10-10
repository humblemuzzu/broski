/**
 * Codex Filesystem Reader
 *
 * Reads Codex sessions directly from ~/.codex/sessions/ without spawning app-server, through the
 * session-file primitives in `src/utils`: head reads instead of whole-file reads, bounded pools
 * instead of unbounded `Promise.all`, and the SQLite index for thread id → rollout path lookups.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CodexThread, CodexTranscriptMessage } from "../types";
import { runPool } from "../utils/bounded-pool";
import { collectRolloutFiles, type RolloutRoots } from "./codex/cx-rollout-files";
import { cachedRolloutHeadWithPreview } from "./codex/cx-rollout-meta";
import { computeCxThreadStats } from "./codex/cx-session-stats";
import { findRolloutPathById } from "./codex/cx-sqlite";
import { CX_STATS_CONCURRENCY, resolveRolloutPaths } from "./codex/cx-thread-enrich";
import { DEFAULT_CX_TRANSCRIPT_LIMIT, readCxTranscript } from "./codex/cx-transcript";

export { listProjectsFromFs } from "./codex/cx-projects";
export { enrichThreadsWithStats } from "./codex/cx-thread-enrich";

export const DEFAULT_CX_ENRICH_LIMIT = 200;
const THREAD_SCAN_CONCURRENCY = 8;

export type CxFsOptions = {
	roots?: RolloutRoots;
	/** Threads to compute diff stats for; the phone only ever renders one page. */
	enrichLimit?: number;
};

async function fileTimes(filePath: string): Promise<{ createdAt: number; updatedAt: number } | null> {
	try {
		const info = await stat(filePath);
		return {
			createdAt: Math.floor(info.birthtime.getTime() / 1000),
			updatedAt: Math.floor(info.mtime.getTime() / 1000),
		};
	} catch {
		return null;
	}
}

type ThreadCandidate = { thread: CodexThread; filePath: string };

/** List all Codex threads (sessions) directly from the filesystem. */
export async function listThreadsFromFs(cwd?: string, options: CxFsOptions = {}): Promise<CodexThread[]> {
	const normalizedCwd = cwd ? resolve(cwd) : null;
	const files = await collectRolloutFiles(options.roots);
	const candidates: ThreadCandidate[] = [];

	await runPool(files, THREAD_SCAN_CONCURRENCY, async (filePath) => {
		const [times, head] = await Promise.all([fileTimes(filePath), cachedRolloutHeadWithPreview(filePath)]);
		if (!times || !head?.id) return;
		if (normalizedCwd && (head.cwd ? resolve(head.cwd) : "") !== normalizedCwd) return;

		candidates.push({
			thread: {
				id: head.id,
				preview: head.preview ?? `Session ${head.id.slice(0, 8)}`,
				modelProvider: head.modelProvider,
				createdAt: times.createdAt,
				updatedAt: times.updatedAt,
				cwd: head.cwd,
				cliVersion: head.cliVersion,
				gitInfo: head.gitBranch ? { branch: head.gitBranch } : null,
			},
			filePath,
		});
	});

	candidates.sort((a, b) => (b.thread.createdAt ?? 0) - (a.thread.createdAt ?? 0));

	await runPool(
		candidates.slice(0, options.enrichLimit ?? DEFAULT_CX_ENRICH_LIMIT),
		CX_STATS_CONCURRENCY,
		async ({ thread, filePath }) => {
			const summary = await computeCxThreadStats(filePath, thread.id);
			if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
				thread.summary = summary;
			}
		},
	);

	return candidates.map((candidate) => candidate.thread);
}

/** Get a specific thread by ID from filesystem. */
export async function getThreadFromFs(threadId: string, options: CxFsOptions = {}): Promise<CodexThread | null> {
	const filePath = await findThreadFilePath(threadId, options.roots);
	if (!filePath) return null;

	const [times, head, summary] = await Promise.all([
		fileTimes(filePath),
		cachedRolloutHeadWithPreview(filePath),
		computeCxThreadStats(filePath, threadId),
	]);
	if (!head?.id) return null;

	return {
		id: head.id,
		preview: head.preview ?? `Session ${head.id.slice(0, 8)}`,
		modelProvider: head.modelProvider,
		createdAt: times?.createdAt ?? 0,
		updatedAt: times?.updatedAt ?? 0,
		cwd: head.cwd,
		cliVersion: head.cliVersion,
		gitInfo: head.gitBranch ? { branch: head.gitBranch } : null,
		...(summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0) ? { summary } : {}),
	};
}

/**
 * Find the session file path for a thread ID.
 * Tries the SQLite rollout_path index first (one indexed query), then a head-only filesystem scan.
 */
export async function findThreadFilePath(threadId: string, roots?: RolloutRoots): Promise<string | null> {
	const sqlitePath = findRolloutPathById(threadId);
	if (sqlitePath) return sqlitePath;

	const resolved = await resolveRolloutPaths([threadId], roots);
	return resolved.get(threadId) ?? null;
}

/** Get per-file modified files for a Codex thread (for sidebar display). */
export async function getModifiedFiles(
	threadId: string,
): Promise<import("../handlers/session-stats").ModifiedFileEntry[]> {
	const filePath = await findThreadFilePath(threadId);
	if (!filePath) return [];
	const { getCxModifiedFiles } = await import("./codex/cx-session-stats");
	return getCxModifiedFiles(filePath);
}

/**
 * Read thread messages directly from the session file, keeping only the last `limit` messages.
 *
 * A rollout line only ever joins the message that is open at that point, and a message closes at
 * the next user message, so the transcript is streamed in order and windowed at the end rather
 * than read whole.
 */
export async function getThreadMessagesFromFs(
	threadId: string,
	options: { limit?: number; roots?: RolloutRoots } = {},
): Promise<CodexTranscriptMessage[]> {
	const filePath = await findThreadFilePath(threadId, options.roots);
	if (!filePath) return [];
	return readCxTranscript(filePath, { limit: options.limit ?? DEFAULT_CX_TRANSCRIPT_LIMIT });
}
