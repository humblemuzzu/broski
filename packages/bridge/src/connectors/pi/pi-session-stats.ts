/**
 * Pi session diff statistics.
 * Scans Pi .jsonl session files to compute per-session code change summaries.
 * Pi stores messages as JSONL entries. The edit tool produces `details.diff` (unified diff).
 * The write tool creates new files (counted as all-additions).
 * Cached by sessionId:mtime to avoid re-scanning unchanged files.
 */

import { stat } from "node:fs/promises";
import type { ModifiedFileEntry, SessionDiffSummary } from "../../handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats, deduplicateFileDiffs } from "../../handlers/session-stats";

// Cache: sessionPath → { mtime, summary }
const statsCache = new Map<string, { mtime: number; summary: SessionDiffSummary }>();

/**
 * Scan a Pi .jsonl session file and extract per-file diff entries.
 *
 * Pi JSONL contains two relevant message types:
 *   1. assistant messages with toolCall entries (has arguments.path + arguments.content)
 *   2. toolResult messages with details.diff (for edits) or success text (for writes)
 *
 * For edits: we use details.diff from the toolResult (real +/- counts).
 * For writes: we use arguments.content from the preceding assistant toolCall
 *             to count real lines, since the toolResult only has a byte count.
 */
async function scanPiFileDiffs(
	filePath: string,
): Promise<Array<{ file: string; additions: number; deletions: number }>> {
	const text = await Bun.file(filePath).text();
	await Bun.sleep(0);
	const lines = text.split("\n");
	const fileDiffs: Array<{ file: string; additions: number; deletions: number }> = [];

	// Pass 1: Collect tool call arguments from assistant messages.
	// Maps toolCallId → { name, path, content, old_str, new_str }
	const toolCallArgs = new Map<string, { name: string; path: string; content?: string; oldStr?: string; newStr?: string }>();

	for (const line of lines) {
		if (!line) continue;
		if (!line.includes('"toolCall"')) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (parsed?.type !== "message") continue;
		const message = parsed?.message;
		if (!message || message.role !== "assistant") continue;

		const content = Array.isArray(message.content) ? message.content : [];
		for (const item of content) {
			if (item?.type !== "toolCall") continue;
			const id = item.id as string | undefined;
			const name = item.name as string | undefined;
			const args = item.arguments;
			if (!id || !name || !args || typeof args !== "object") continue;

			const path = typeof args.path === "string" ? args.path : "";
			if (!path) continue;

			toolCallArgs.set(id, {
				name,
				path,
				content: typeof args.content === "string" ? args.content : undefined,
				oldStr: typeof args.old_str === "string" ? args.old_str : undefined,
				newStr: typeof args.new_str === "string" ? args.new_str : undefined,
			});
		}
	}

	// Pass 2: Process toolResult messages.
	for (const line of lines) {
		if (!line) continue;
		if (!line.includes('"toolResult"')) continue;
		if (!line.includes('"edit"') && !line.includes('"write"')) continue;

		let parsed: any;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (parsed?.type !== "message") continue;
		const message = parsed?.message;
		if (!message || message.role !== "toolResult") continue;

		const toolName = message.toolName as string | undefined;
		if (!toolName) continue;
		const toolCallId = message.toolCallId as string | undefined;
		const callArgs = toolCallId ? toolCallArgs.get(toolCallId) : undefined;

		if (toolName === "edit") {
			// Pi edit results store data in two places:
			//   - details.filePath: the edited file's absolute path
			//   - details.diff: unified diff (Pi's generateDiffString output)
			//   - content[0].text: may ALSO contain the diff (standard unified format)
			// Some Pi versions put the diff in details.diff, others in content text.
			const details = message.details;
			let diff = "";
			let file = "";

			// File path: toolCall args > details.filePath > diff header > content text
			file = callArgs?.path ?? "";
			if (!file && details && typeof details === "object") {
				file = typeof details.filePath === "string" ? details.filePath : "";
			}

			// Diff: details.diff > content[0].text (if it looks like a diff)
			if (details && typeof details === "object" && typeof details.diff === "string" && details.diff.length > 20) {
				diff = details.diff;
			}
			if (!diff) {
				const msgContent = Array.isArray(message.content) ? message.content : [];
				for (const c of msgContent) {
					if (c?.type === "text" && typeof c.text === "string") {
						// Check if content text IS a diff (starts with --- or has @@ markers)
						if (c.text.startsWith("---") || c.text.includes("@@")) {
							diff = c.text;
							break;
						}
					}
				}
			}
			if (!diff) continue;

			// Extract file path from diff header if still missing
			if (!file) {
				// Standard: "--- a/path" or Pi format: "--- filename\toriginal"
				const headerMatch = diff.match(/^---\s+(?:a\/)?(\S+)/m);
				if (headerMatch) file = headerMatch[1];
			}
			if (!file) file = "unknown";

			const stats = countUnifiedDiffStats(diff);
			if (stats.additions > 0 || stats.deletions > 0) {
				fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions });
			}
			continue;
		}

		if (toolName === "write") {
			// File path from toolCall arguments (exact)
			const file = callArgs?.path ?? "";
			if (!file) continue;

			// Real line count from the actual file content in toolCall arguments
			const fileContent = callArgs?.content;
			if (typeof fileContent === "string" && fileContent.length > 0) {
				const lineCount = fileContent.split("\n").length;
				fileDiffs.push({ file, additions: lineCount, deletions: 0 });
			}
		}
	}

	return fileDiffs;
}

/**
 * Compute diff stats for a Pi session by scanning its .jsonl file.
 * Extracts data from toolResult messages where toolName is "edit" or "write".
 */
export async function computePiSessionStats(filePath: string): Promise<SessionDiffSummary | null> {
	try {
		const fileStat = await stat(filePath);
		const mtime = fileStat.mtime.getTime();

		const cached = statsCache.get(filePath);
		if (cached && cached.mtime === mtime) {
			return cached.summary;
		}

		const fileDiffs = await scanPiFileDiffs(filePath);
		const summary = aggregateFileDiffs(fileDiffs);
		statsCache.set(filePath, { mtime, summary });
		return summary;
	} catch {
		return null;
	}
}

/**
 * Get per-file modified files for a Pi session (for sidebar display).
 * Returns deduplicated array of {file, additions, deletions}.
 */
export async function getPiModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		const fileDiffs = await scanPiFileDiffs(filePath);
		return deduplicateFileDiffs(fileDiffs);
	} catch {
		return [];
	}
}

/** Clear the stats cache. */
export function clearPiStatsCache(sessionPath?: string): void {
	if (sessionPath) {
		statsCache.delete(sessionPath);
	} else {
		statsCache.clear();
	}
}
