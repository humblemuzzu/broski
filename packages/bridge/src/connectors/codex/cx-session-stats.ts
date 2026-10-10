/**
 * Codex thread diff statistics.
 * Streams Codex .jsonl rollout files and computes per-thread code change summaries.
 * Results are cached per rollout path until the file's fingerprint changes, so a re-listed page
 * costs one `stat` per thread.
 */

import type { ModifiedFileEntry, SessionDiffSummary } from "../../handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats, deduplicateFileDiffs } from "../../handlers/session-stats";
import { FileFingerprintCache } from "../../utils/file-fingerprint-cache";
import { readJsonlLines } from "../../utils/jsonl-lines";

const CACHE_BYTE_BUDGET = 8 * 1024 * 1024;
const ESTIMATED_ENTRY_BYTES = 64;
const PATCH_FILE_PATTERN = /\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g;
const DIFF_MARKERS = ["apply_patch", "fileChange", "file_change"];

type FileDiff = { file: string; additions: number; deletions: number };

type ParsedRecord = { type: string; payload: Record<string, unknown> };

function parseRecord(line: string): ParsedRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const record = parsed as { type?: unknown; payload?: unknown };
	const payload = typeof record.payload === "object" && record.payload !== null ? record.payload : {};
	return { type: typeof record.type === "string" ? record.type : "", payload: payload as Record<string, unknown> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function patchFileDiffs(patch: string): FileDiff[] {
	const diffs: FileDiff[] = [];
	const stats = countUnifiedDiffStats(patch);
	for (const match of patch.matchAll(PATCH_FILE_PATTERN)) {
		const file = match[1]?.trim();
		if (!file) continue;
		diffs.push({ file, additions: stats.additions, deletions: stats.deletions });
	}
	return diffs;
}

function fileChangeDiffs(record: ParsedRecord): FileDiff[] {
	const candidate =
		record.payload.item === undefined || record.payload.item === null ? record.payload : record.payload.item;
	if (!isRecord(candidate) || candidate.type !== "fileChange" || !Array.isArray(candidate.changes)) return [];
	const changes = Array.isArray(candidate.changes) ? candidate.changes : [];
	const diffs: FileDiff[] = [];
	for (const change of changes) {
		if (!isRecord(change)) continue;
		const file = typeof change.path === "string" ? change.path : "";
		const diff = typeof change.diff === "string" ? change.diff : "";
		if (!file || !diff) continue;
		const stats = countUnifiedDiffStats(diff);
		diffs.push({ file, additions: stats.additions, deletions: stats.deletions });
	}
	return diffs;
}

function diffsFromRecord(record: ParsedRecord): FileDiff[] {
	const payload = record.payload;
	if (record.type === "response_item" && payload.type === "custom_tool_call" && payload.name === "apply_patch") {
		const input = typeof payload.input === "string" ? payload.input : "";
		return input ? patchFileDiffs(input) : [];
	}
	if (record.type === "response_item" && payload.type === "function_call" && payload.name === "apply_patch") {
		let args: Record<string, unknown> = {};
		try {
			const parsed: unknown = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments;
			if (isRecord(parsed)) args = parsed;
		} catch {
			/* arguments are not JSON — treat as an empty patch */
		}
		const patch = typeof args.patch === "string" ? args.patch : "";
		return patch ? patchFileDiffs(patch) : [];
	}
	if (record.type === "event_msg" || record.type === "item") return fileChangeDiffs(record);
	return [];
}

/** Scan a Codex .jsonl file and extract per-file diff entries. */
async function scanCxFileDiffs(filePath: string): Promise<FileDiff[]> {
	const fileDiffs: FileDiff[] = [];
	for await (const line of readJsonlLines(filePath)) {
		if (!line.trim()) continue;
		if (!DIFF_MARKERS.some((marker) => line.includes(marker))) continue;
		const record = parseRecord(line);
		if (record) fileDiffs.push(...diffsFromRecord(record));
	}
	return fileDiffs;
}

const statsCache = new FileFingerprintCache<SessionDiffSummary | null>({
	byteBudget: CACHE_BYTE_BUDGET,
	estimateBytes: () => ESTIMATED_ENTRY_BYTES,
	shedOnPressure: true,
});

const rolloutPathByThreadId = new Map<string, string>();

/**
 * Compute diff stats for a Codex thread by scanning its .jsonl file.
 * Extracts data from:
 *  - response_item type=custom_tool_call name=apply_patch (with unified diff in input)
 *  - event_item type=item with item.type=fileChange (with item.changes[].diff)
 */
export async function computeCxThreadStats(filePath: string, threadId: string): Promise<SessionDiffSummary | null> {
	rolloutPathByThreadId.set(threadId, filePath);
	return statsCache.get(filePath, async () => {
		try {
			return aggregateFileDiffs(await scanCxFileDiffs(filePath));
		} catch {
			return null;
		}
	});
}

/** Per-file modified files for a Codex thread (for sidebar display). */
export async function getCxModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		return deduplicateFileDiffs(await scanCxFileDiffs(filePath));
	} catch {
		return [];
	}
}

/** Clear the stats cache, or one thread's entry when a thread id is given. */
export function clearCxStatsCache(threadId?: string): void {
	if (!threadId) {
		statsCache.clear();
		rolloutPathByThreadId.clear();
		return;
	}
	const filePath = rolloutPathByThreadId.get(threadId);
	if (!filePath) return;
	statsCache.delete(filePath);
	rolloutPathByThreadId.delete(threadId);
}
