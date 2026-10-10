/**
 * Parsing helpers for Claude Code transcript lines.
 *
 * Extracted from claude-code.ts (frozen file); shared by the session preview reader and the
 * transcript builder.
 */

export type ClaudeTranscriptLine = {
	type?: string;
	sessionId?: string;
	session_id?: string;
	uuid?: string;
	timestamp?: string;
	cwd?: string;
	gitBranch?: string;
	slug?: string;
	isMeta?: boolean;
	parent_tool_use_id?: string;
	toolUseResult?: unknown;
	message?: {
		role?: string;
		content?: unknown;
		model?: string;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
		};
	};
};

/** Content block shape from Claude Code JSONL transcripts (parsed from JSON). */
export type TranscriptContentBlock = {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
};

export function safeParseJsonLine(line: string): ClaudeTranscriptLine | null {
	try {
		return JSON.parse(line) as ClaudeTranscriptLine;
	} catch {
		return null;
	}
}

export function isLikelyCommandEcho(text: string): boolean {
	const t = text.trim();
	if (t.startsWith("<command-name>")) return true;
	if (t.startsWith("<local-command-")) return true;
	if (t.startsWith("<command-message>")) return true;
	if (t.startsWith("<command-args>")) return true;
	if (t.startsWith("<local-command-stdout>")) return true;
	if (t.startsWith("<local-command-stderr>")) return true;
	return false;
}

export function extractFirstTextContent(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (block && typeof block === "object") {
				const b = block as TranscriptContentBlock;
				if (b.type === "text" && typeof b.text === "string") {
					return b.text;
				}
			}
		}
	}
	return null;
}

export function isoToMs(ts?: string): number {
	if (!ts) return Date.now();
	const parsed = Date.parse(ts);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

export function toolResultToText(result: unknown): string {
	if (result == null) return "";
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		const parts: string[] = [];
		for (const item of result) {
			if (item && typeof item === "object") {
				const b = item as TranscriptContentBlock;
				if (b.type === "text" && typeof b.text === "string") {
					parts.push(b.text);
				} else if (typeof b.text === "string") {
					parts.push(b.text);
				} else {
					parts.push(JSON.stringify(item));
				}
			} else if (typeof item === "string") {
				parts.push(item);
			}
		}
		return parts.join("\n").trim();
	}
	try {
		return JSON.stringify(result);
	} catch {
		return String(result);
	}
}

export function structuredPatchToUnifiedDiff(
	filePath: string,
	patches: any[],
): { diff: string; additions: number; deletions: number } | null {
	if (!Array.isArray(patches) || patches.length === 0) return null;
	const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
	let additions = 0;
	let deletions = 0;
	let body = "";

	for (const hunk of patches) {
		const oldStart = Number(hunk?.oldStart ?? 0);
		const oldLines = Number(hunk?.oldLines ?? 0);
		const newStart = Number(hunk?.newStart ?? 0);
		const newLines = Number(hunk?.newLines ?? 0);
		const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
		body += `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n`;
		for (const line of lines) {
			if (typeof line !== "string") continue;
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			if (line.startsWith("-") && !line.startsWith("---")) deletions++;
			body += `${line}\n`;
		}
	}

	return { diff: header + body, additions, deletions };
}

export function toolUseResultToDiff(
	toolUseResult: any,
): { diff?: string; before: string; after: string; file: string; additions: number; deletions: number } | null {
	if (!toolUseResult || typeof toolUseResult !== "object") return null;
	const filePath = toolUseResult.filePath as string | undefined;
	if (!filePath) return null;

	// If Claude Code provides structuredPatch, prefer a unified diff.
	const structuredPatch = toolUseResult.structuredPatch;
	const patchDiff = structuredPatchToUnifiedDiff(filePath, structuredPatch);
	if (patchDiff) {
		return {
			file: filePath,
			before: "",
			after: "",
			diff: patchDiff.diff,
			additions: patchDiff.additions,
			deletions: patchDiff.deletions,
		};
	}

	// Fallback: best-effort from old/new string snippets.
	const before =
		typeof toolUseResult.oldString === "string"
			? toolUseResult.oldString
			: typeof toolUseResult.originalFile === "string"
				? toolUseResult.originalFile
				: "";
	const after =
		typeof toolUseResult.newString === "string"
			? toolUseResult.newString
			: typeof toolUseResult.content === "string"
				? toolUseResult.content
				: "";
	return {
		file: filePath,
		before,
		after,
		additions: 0,
		deletions: 0,
	};
}
