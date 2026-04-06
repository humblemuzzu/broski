/**
 * Codex thread diff statistics.
 * Scans Codex .jsonl session files to compute per-thread code change summaries.
 * Cached by threadId:mtime to avoid re-scanning unchanged files.
 */

import { stat } from "node:fs/promises";
import type { ModifiedFileEntry, SessionDiffSummary } from "../../handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats, deduplicateFileDiffs } from "../../handlers/session-stats";

// Cache: threadId → { mtime, summary }
const statsCache = new Map<string, { mtime: number; summary: SessionDiffSummary }>();

/** Scan a Codex .jsonl file and extract per-file diff entries. */
async function scanCxFileDiffs(
	filePath: string,
): Promise<Array<{ file: string; additions: number; deletions: number }>> {
	const text = await Bun.file(filePath).text();
	const lines = text.split("\n");
	const fileDiffs: Array<{ file: string; additions: number; deletions: number }> = [];

	for (const line of lines) {
		if (!line) continue;
		// Quick string filter — only parse lines that might contain file changes
		if (!line.includes("apply_patch") && !line.includes("fileChange") && !line.includes("file_change")) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		const type = parsed?.type;
		const payload = parsed?.payload;

		// Format 1: custom_tool_call with apply_patch
		if (type === "response_item" && payload?.type === "custom_tool_call" && payload?.name === "apply_patch") {
			const input = typeof payload.input === "string" ? payload.input : "";
			if (!input) continue;

			const fileMatches = input.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g);
			for (const match of fileMatches) {
				const file = match[1]?.trim();
				if (!file) continue;
				const stats = countUnifiedDiffStats(input);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
			continue;
		}

		// Format 2: function_call with apply_patch
		if (type === "response_item" && payload?.type === "function_call" && payload?.name === "apply_patch") {
			let args: any = {};
			try {
				args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : (payload.arguments ?? {});
			} catch {
				/* ignore */
			}
			const patch = typeof args.patch === "string" ? args.patch : "";
			if (!patch) continue;

			const fileMatches = patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g);
			for (const match of fileMatches) {
				const file = match[1]?.trim();
				if (!file) continue;
				const stats = countUnifiedDiffStats(patch);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
			continue;
		}

		// Format 3: Codex v2 item events with fileChange type
		if (type === "event_msg" || type === "item") {
			const item = payload?.item ?? payload;
			if (item?.type !== "fileChange") continue;
			const changes = Array.isArray(item.changes) ? item.changes : [];
			for (const ch of changes) {
				const diff = typeof ch?.diff === "string" ? ch.diff : "";
				const file = typeof ch?.path === "string" ? ch.path : "";
				if (!file || !diff) continue;
				const stats = countUnifiedDiffStats(diff);
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
		}
	}

	return fileDiffs;
}

/**
 * Compute diff stats for a Codex thread by scanning its .jsonl file.
 * Extracts data from:
 *  - response_item type=custom_tool_call name=apply_patch (with unified diff in input)
 *  - event_msg type=item with item.type=fileChange (with item.changes[].diff)
 */
export async function computeCxThreadStats(filePath: string, threadId: string): Promise<SessionDiffSummary | null> {
	try {
		const fileStat = await stat(filePath);
		const mtime = fileStat.mtime.getTime();

		// Check cache
		const cached = statsCache.get(threadId);
		if (cached && cached.mtime === mtime) {
			return cached.summary;
		}

		const fileDiffs = await scanCxFileDiffs(filePath);
		const summary = aggregateFileDiffs(fileDiffs);
		statsCache.set(threadId, { mtime, summary });
		return summary;
	} catch {
		return null;
	}
}

/**
 * Get per-file modified files for a Codex thread (for sidebar display).
 * Returns deduplicated array of {file, additions, deletions}.
 */
export async function getCxModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		const fileDiffs = await scanCxFileDiffs(filePath);
		return deduplicateFileDiffs(fileDiffs);
	} catch {
		return [];
	}
}

/** Clear the stats cache. */
export function clearCxStatsCache(threadId?: string): void {
	if (threadId) {
		statsCache.delete(threadId);
	} else {
		statsCache.clear();
	}
}
