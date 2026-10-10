/**
 * Claude Code session diff statistics.
 * Scans .jsonl transcript files to compute per-session code change summaries.
 * Lines are streamed one at a time and summaries are cached by file fingerprint,
 * so a refresh costs one `stat` per unchanged session.
 */

import type { ModifiedFileEntry, SessionDiffSummary } from "../../handlers/session-stats";
import { aggregateFileDiffs, deduplicateFileDiffs } from "../../handlers/session-stats";
import { FileFingerprintCache } from "../../utils/file-fingerprint-cache";
import { readJsonlLines } from "../../utils/jsonl-lines";

const STATS_CACHE_BYTE_BUDGET = 4 * 1024 * 1024;

const statsCache = new FileFingerprintCache<SessionDiffSummary | null>({
	byteBudget: STATS_CACHE_BYTE_BUDGET,
	estimateBytes: () => 128,
	shedOnPressure: true,
});

type FileDiff = { file: string; additions: number; deletions: number };

function countsFromStructuredPatch(structuredPatch: unknown): { additions: number; deletions: number } | null {
	if (!Array.isArray(structuredPatch) || structuredPatch.length === 0) return null;
	let additions = 0;
	let deletions = 0;
	for (const hunk of structuredPatch) {
		const hunkLines = Array.isArray(hunk?.lines) ? hunk.lines : [];
		for (const l of hunkLines) {
			if (typeof l !== "string") continue;
			if (l.startsWith("+") && !l.startsWith("+++")) additions++;
			if (l.startsWith("-") && !l.startsWith("---")) deletions++;
		}
	}
	return additions > 0 || deletions > 0 ? { additions, deletions } : null;
}

function countsFromOldNewStrings(
	toolUseResult: Record<string, unknown>,
): { additions: number; deletions: number } | null {
	const oldStr = typeof toolUseResult.oldString === "string" ? toolUseResult.oldString : "";
	const newStr = typeof toolUseResult.newString === "string" ? toolUseResult.newString : "";
	if (!oldStr && !newStr) return null;
	const oldLines = oldStr ? oldStr.split("\n").length : 0;
	const newLines = newStr ? newStr.split("\n").length : 0;
	const additions = Math.max(0, newLines - oldLines);
	const deletions = Math.max(0, oldLines - newLines);
	return additions > 0 || deletions > 0 ? { additions, deletions } : null;
}

function diffEntryForLine(line: string): FileDiff | null {
	if (!line) return null;
	// Quick string check before parsing - toolUseResult only appears on tool_result lines
	if (!line.includes("toolUseResult")) return null;

	let parsed: any;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}

	const toolUseResult = parsed?.toolUseResult;
	if (!toolUseResult || typeof toolUseResult !== "object") return null;
	const file = toolUseResult.filePath as string | undefined;
	if (!file) return null;

	const counts = countsFromStructuredPatch(toolUseResult.structuredPatch) ?? countsFromOldNewStrings(toolUseResult);
	return counts ? { file, ...counts } : null;
}

/** Scan a CC .jsonl transcript and extract per-file diff entries. */
async function scanCCFileDiffs(filePath: string): Promise<FileDiff[]> {
	const fileDiffs: FileDiff[] = [];
	for await (const line of readJsonlLines(filePath)) {
		const entry = diffEntryForLine(line);
		if (entry) fileDiffs.push(entry);
	}
	return fileDiffs;
}

/**
 * Compute diff stats for a single CC session by scanning its .jsonl transcript.
 * Uses toolUseResult entries (same data source as the streaming diff viewer).
 * Returns null if the file can't be read.
 */
export function computeCCSessionStats(filePath: string): Promise<SessionDiffSummary | null> {
	return statsCache.get(filePath, async () => {
		try {
			return aggregateFileDiffs(await scanCCFileDiffs(filePath));
		} catch {
			return null;
		}
	});
}

/**
 * Get per-file modified files for a CC session (for sidebar display).
 * Returns deduplicated array of {file, additions, deletions}.
 */
export async function getCCModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		const fileDiffs = await scanCCFileDiffs(filePath);
		return deduplicateFileDiffs(fileDiffs);
	} catch {
		return [];
	}
}

/** Clear the stats cache (e.g., on session delete). */
export function clearCCStatsCache(): void {
	statsCache.clear();
}
