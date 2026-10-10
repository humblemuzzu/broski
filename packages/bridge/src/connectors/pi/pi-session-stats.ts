/**
 * Pi session diff statistics.
 *
 * One streaming pass per session file computes both the diff summary and the subagent tool count,
 * cached by file fingerprint with a byte budget. Pi stores messages as JSONL entries: the edit tool
 * produces `details.diff` (unified diff), the write tool creates new files (counted as additions).
 */

import type { AssistantMessage, JsonObject, ToolResultMessage } from "@earendil-works/pi-ai";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { ModifiedFileEntry, SessionDiffSummary } from "../../handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats, deduplicateFileDiffs } from "../../handlers/session-stats";
import { FileFingerprintCache } from "../../utils/file-fingerprint-cache";
import { readJsonlLines } from "../../utils/jsonl-lines";

export type PiSessionStatsScan = {
	summary: SessionDiffSummary;
	toolCount: number;
	modified: ModifiedFileEntry[];
	/**
	 * A raw `\r` between characters, or a `\u2028` / `\u2029`, which Node's readline breaks on and the
	 * head scanner's reader does not. The listing computes such a file with the SDK's own reader.
	 */
	lineSeparatorInLine: boolean;
};

/** Cache budget for scanned session stats; each entry is a few hundred bytes. */
export const PI_STATS_CACHE_BYTES = 32 * 1024 * 1024;

const SUBAGENT_TOOL_NAMES = new Set(["task", "Task", "oracle", "finder", "code_review", "look_at", "librarian"]);

/** Readline-only line breaks, which a decoded line keeps inside itself. */
function hasRawLineSeparator(line: string): boolean {
	return line.includes("\u2028") || line.includes("\u2029") || line.includes("\r");
}

type FileDiffs = Array<{ file: string; additions: number; deletions: number }>;
type ToolCallArgs = { path: string; writeLineCount?: number };

const entryCache = new FileFingerprintCache<PiSessionStatsScan>({
	byteBudget: PI_STATS_CACHE_BYTES,
	estimateBytes: (value) => 256 + value.modified.length * 160,
});

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countLines(text: string): number {
	let lines = 1;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) lines++;
	}
	return lines;
}

function collectToolCallArgs(message: AssistantMessage, toolCallArgs: Map<string, ToolCallArgs>): void {
	for (const block of message.content) {
		if (block.type !== "toolCall") continue;
		const args = block.arguments;
		const path = typeof args.path === "string" ? args.path : "";
		if (!path) continue;

		const content = typeof args.content === "string" && args.content.length > 0 ? args.content : undefined;
		toolCallArgs.set(block.id, {
			path,
			...(content !== undefined ? { writeLineCount: countLines(content) } : {}),
		});
	}
}

function countSubagentCalls(message: AssistantMessage): number {
	let count = 0;
	for (const block of message.content) {
		if (block.type === "toolCall" && SUBAGENT_TOOL_NAMES.has(block.name)) count++;
	}
	return count;
}

function resultToDiffs(message: ToolResultMessage, toolCallArgs: Map<string, ToolCallArgs>): FileDiffs {
	const callArgs = toolCallArgs.get(message.toolCallId);
	const details = isJsonObject(message.details) ? message.details : undefined;

	if (message.toolName === "edit") {
		// Pi edit results store data in two places:
		//   - details.filePath: the edited file's absolute path
		//   - details.diff: unified diff (Pi's generateDiffString output)
		//   - content[0].text: may ALSO contain the diff (standard unified format)
		let file = callArgs?.path ?? "";
		if (!file && typeof details?.filePath === "string") {
			file = details.filePath;
		}

		let diff = "";
		if (typeof details?.diff === "string" && details.diff.length > 20) {
			diff = details.diff;
		}
		if (!diff) {
			for (const block of message.content) {
				if (block.type === "text" && (block.text.startsWith("---") || block.text.includes("@@"))) {
					diff = block.text;
					break;
				}
			}
		}
		if (!diff) return [];

		if (!file) {
			// Standard: "--- a/path" or Pi format: "--- filename\toriginal"
			const headerMatch = diff.match(/^---\s+(?:a\/)?(\S+)/m);
			const headerFile = headerMatch?.[1];
			if (headerFile) file = headerFile;
		}
		if (!file) file = "unknown";

		const stats = countUnifiedDiffStats(diff);
		return stats.additions > 0 || stats.deletions > 0
			? [{ file, additions: stats.additions, deletions: stats.deletions }]
			: [];
	}

	if (message.toolName === "write") {
		const file = callArgs?.path ?? "";
		const writeLineCount = callArgs?.writeLineCount;
		if (!file || writeLineCount === undefined) return [];
		return [{ file, additions: writeLineCount, deletions: 0 }];
	}

	return [];
}

/**
 * Scan a Pi .jsonl session file once for per-file diffs and subagent tool calls.
 *
 * Pi JSONL contains two relevant message types:
 *   1. assistant messages with toolCall entries (has arguments.path + arguments.content)
 *   2. toolResult messages with details.diff (for edits) or success text (for writes)
 *
 * For edits: we use details.diff from the toolResult (real +/- counts).
 * For writes: we use arguments.content from the preceding assistant toolCall
 *             to count real lines, since the toolResult only has a byte count.
 */
export async function scanPiSessionFile(filePath: string): Promise<PiSessionStatsScan> {
	const toolCallArgs = new Map<string, ToolCallArgs>();
	const fileDiffs: FileDiffs = [];
	let toolCount = 0;
	let lineSeparatorInLine = false;

	for await (const line of readJsonlLines(filePath)) {
		if (!lineSeparatorInLine && hasRawLineSeparator(line)) lineSeparatorInLine = true;
		if (
			!line.includes('"toolCall"') &&
			!(line.includes('"toolResult"') && (line.includes('"edit"') || line.includes('"write"')))
		) {
			continue;
		}
		for (const entry of parseSessionEntries(line)) {
			if (entry.type !== "message") continue;
			const message = entry.message;

			if (message.role === "assistant") {
				toolCount += countSubagentCalls(message);
				collectToolCallArgs(message, toolCallArgs);
				continue;
			}

			if (message.role === "toolResult") {
				fileDiffs.push(...resultToDiffs(message, toolCallArgs));
			}
		}
	}

	return {
		summary: aggregateFileDiffs(fileDiffs),
		toolCount,
		modified: deduplicateFileDiffs(fileDiffs),
		lineSeparatorInLine,
	};
}

/** Diff summary, subagent tool count and modified files for one session file, cached by fingerprint. */
export async function scanPiSessionStats(filePath: string): Promise<PiSessionStatsScan> {
	return entryCache.get(filePath, () => scanPiSessionFile(filePath));
}

/** Compute diff stats for a Pi session by scanning its .jsonl file. */
export async function computePiSessionStats(filePath: string): Promise<SessionDiffSummary | null> {
	try {
		return (await scanPiSessionStats(filePath)).summary;
	} catch {
		return null;
	}
}

/** Count subagent tool invocations in a Pi session JSONL. */
export async function countSubagentTools(filePath: string): Promise<number> {
	try {
		return (await scanPiSessionStats(filePath)).toolCount;
	} catch {
		return 0;
	}
}

/** Get per-file modified files for a Pi session (for sidebar display). */
export async function getPiModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		return (await scanPiSessionStats(filePath)).modified;
	} catch {
		return [];
	}
}

export function clearPiStatsCache(sessionPath?: string): void {
	if (sessionPath) {
		entryCache.delete(sessionPath);
		return;
	}
	entryCache.clear();
}

export function getPiStatsCacheStats(): { entries: number; bytes: number; hits: number; misses: number } {
	return entryCache.stats();
}
