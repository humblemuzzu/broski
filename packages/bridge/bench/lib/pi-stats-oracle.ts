/**
 * The pre-optimisation Pi stats scan: `node:readline` streaming, two separate passes per file and
 * two mtime-keyed caches. Kept verbatim in behaviour so parity tests can diff it against the single
 * merged pass that replaced it.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AssistantMessage, JsonObject, ToolResultMessage } from "@earendil-works/pi-ai";
import { type FileEntry, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import type { ModifiedFileEntry, SessionDiffSummary } from "../../src/handlers/session-stats";
import { aggregateFileDiffs, countUnifiedDiffStats, deduplicateFileDiffs } from "../../src/handlers/session-stats";

const statsCache = new Map<string, { mtime: number; summary: SessionDiffSummary }>();
const subagentCountCache = new Map<string, { mtime: number; count: number }>();

const SUBAGENT_TOOL_NAMES = new Set(["task", "Task", "oracle", "finder", "code_review", "look_at", "librarian"]);

type FileDiffs = Array<{ file: string; additions: number; deletions: number }>;
type ToolCallArgs = { path: string; writeLineCount?: number };

export function clearLegacyStatsCache(): void {
	statsCache.clear();
	subagentCountCache.clear();
}

async function forEachEntry(
	filePath: string,
	matches: (line: string) => boolean,
	visit: (entry: FileEntry) => void,
): Promise<void> {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!matches(line)) continue;
			for (const entry of parseSessionEntries(line)) visit(entry);
		}
	} finally {
		lines.close();
		stream.destroy();
	}
}

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

export async function legacyCountSubagentTools(filePath: string): Promise<number> {
	try {
		const fileStat = await stat(filePath);
		const mtime = fileStat.mtime.getTime();

		const cached = subagentCountCache.get(filePath);
		if (cached && cached.mtime === mtime) return cached.count;

		let count = 0;
		await forEachEntry(
			filePath,
			(line) => line.includes('"toolCall"'),
			(entry) => {
				if (entry.type !== "message") return;
				const message = entry.message;
				if (message.role !== "assistant") return;
				for (const block of message.content) {
					if (block.type === "toolCall" && SUBAGENT_TOOL_NAMES.has(block.name)) {
						count++;
					}
				}
			},
		);

		subagentCountCache.set(filePath, { mtime, count });
		return count;
	} catch {
		return 0;
	}
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

function resultToDiffs(message: ToolResultMessage, toolCallArgs: Map<string, ToolCallArgs>): FileDiffs {
	const callArgs = toolCallArgs.get(message.toolCallId);
	const details = isJsonObject(message.details) ? message.details : undefined;

	if (message.toolName === "edit") {
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

async function scanPiFileDiffs(filePath: string): Promise<FileDiffs> {
	const toolCallArgs = new Map<string, ToolCallArgs>();
	const fileDiffs: FileDiffs = [];

	await forEachEntry(
		filePath,
		(line) =>
			line.includes('"toolCall"') ||
			(line.includes('"toolResult"') && (line.includes('"edit"') || line.includes('"write"'))),
		(entry) => {
			if (entry.type !== "message") return;
			const message = entry.message;

			if (message.role === "assistant") {
				collectToolCallArgs(message, toolCallArgs);
				return;
			}

			if (message.role === "toolResult") {
				fileDiffs.push(...resultToDiffs(message, toolCallArgs));
			}
		},
	);

	return fileDiffs;
}

export async function legacyGetPiModifiedFiles(filePath: string): Promise<ModifiedFileEntry[]> {
	try {
		return deduplicateFileDiffs(await scanPiFileDiffs(filePath));
	} catch {
		return [];
	}
}

export async function legacyComputePiSessionStats(filePath: string): Promise<SessionDiffSummary | null> {
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
