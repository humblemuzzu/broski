import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } from "@earendil-works/pi-coding-agent";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { defineTool } from "@earendil-works/pi-durable";
import { toPosixPath, walkFiles } from "./fs-walk";
import { matchesGlob } from "./glob-match";
import { toJsonValue } from "./json-value";

const GREP_MAX_LINE_LENGTH = 500;
const GREP_DEFAULT_LIMIT = 100;
const GREP_MAX_FILE_BYTES = 8 * 1024 * 1024;

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

export type GrepSearchOptions = {
	cwd: string;
	pattern: string;
	path?: string | undefined;
	glob?: string | undefined;
	ignoreCase?: boolean | undefined;
	literal?: boolean | undefined;
	context?: number | undefined;
	limit?: number | undefined;
};

export type GrepSearchOutcome = { text: string; details?: JsonValue };

function resolveSearchPath(target: string, cwd: string): string {
	const stripped = target.startsWith("@") ? target.slice(1) : target;
	const expanded = stripped.startsWith("~") ? join(homedir(), stripped.slice(1)) : stripped;
	return resolve(cwd, expanded);
}

function lineMatcher(pattern: string, literal: boolean, ignoreCase: boolean): RegExp {
	const source = literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pattern;
	try {
		return new RegExp(source, ignoreCase ? "i" : "");
	} catch (error) {
		throw new Error(`Invalid pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Undefined when the file cannot be searched: unreadable, too large, or binary. */
async function readSearchableLines(filePath: string): Promise<string[] | undefined> {
	const info = await stat(filePath).catch(() => undefined);
	if (info === undefined || !info.isFile() || info.size > GREP_MAX_FILE_BYTES) return undefined;
	const content = await readFile(filePath, "utf8").catch(() => undefined);
	if (content === undefined || content.includes("\u0000")) return undefined;
	return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function formatMatch(
	displayPath: string,
	lineNumber: number,
	lines: readonly string[],
	contextValue: number,
): { lines: string[]; truncated: boolean } {
	if (contextValue === 0) {
		const single = truncateLine(lines[lineNumber - 1] ?? "");
		return { lines: [`${displayPath}:${lineNumber}: ${single.text}`], truncated: single.wasTruncated };
	}
	const formatted: string[] = [];
	const start = Math.max(1, lineNumber - contextValue);
	const end = Math.min(lines.length, lineNumber + contextValue);
	let truncated = false;
	for (let current = start; current <= end; current += 1) {
		const line = truncateLine(lines[current - 1] ?? "");
		if (line.wasTruncated) truncated = true;
		formatted.push(
			current === lineNumber ? `${displayPath}:${current}: ${line.text}` : `${displayPath}-${current}- ${line.text}`,
		);
	}
	return { lines: formatted, truncated };
}

export async function runGrepSearch(options: GrepSearchOptions): Promise<GrepSearchOutcome> {
	const searchPath = resolveSearchPath(options.path ?? ".", options.cwd);
	const target = await stat(searchPath).catch(() => undefined);
	if (target === undefined) throw new Error(`Path not found: ${searchPath}`);
	const isDirectory = target.isDirectory();
	const matcher = lineMatcher(options.pattern, options.literal === true, options.ignoreCase === true);
	const contextValue = options.context !== undefined && options.context > 0 ? options.context : 0;
	const effectiveLimit = Math.max(1, options.limit ?? GREP_DEFAULT_LIMIT);
	const globPattern = options.glob;
	const outputLines: string[] = [];
	let matchCount = 0;
	let matchLimitReached = false;
	let linesTruncated = false;

	const formatPath = (filePath: string): string => {
		if (isDirectory) {
			const path = toPosixPath(relative(searchPath, filePath));
			if (path !== "" && !path.startsWith("..")) return path;
		}
		return basename(filePath);
	};

	const searchFile = async (filePath: string): Promise<boolean> => {
		const lines = await readSearchableLines(filePath);
		if (lines === undefined) return true;
		const displayPath = formatPath(filePath);
		for (let index = 0; index < lines.length; index += 1) {
			if (!matcher.test(lines[index] ?? "")) continue;
			matchCount += 1;
			const formatted = formatMatch(displayPath, index + 1, lines, contextValue);
			outputLines.push(...formatted.lines);
			if (formatted.truncated) linesTruncated = true;
			if (matchCount >= effectiveLimit) {
				matchLimitReached = true;
				return false;
			}
		}
		return true;
	};

	if (isDirectory) {
		await walkFiles(searchPath, {
			onFile: (absolutePath, relativePath) => {
				if (globPattern !== undefined && !matchesGlob(relativePath, globPattern)) return true;
				return searchFile(absolutePath);
			},
		});
	} else {
		await searchFile(searchPath);
	}

	if (matchCount === 0) return { text: "No matches found" };

	const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
	const details: Record<string, JsonValue> = {};
	const notices: string[] = [];
	if (matchLimitReached) {
		notices.push(
			`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
		);
		details.matchLimitReached = effectiveLimit;
	}
	if (truncation.truncated) {
		notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
		const value = toJsonValue(truncation);
		if (value !== undefined) details.truncation = value;
	}
	if (linesTruncated) {
		notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
		details.linesTruncated = true;
	}
	let text = truncation.content;
	if (notices.length > 0) text += `\n\n[${notices.join(". ")}]`;
	return Object.keys(details).length > 0 ? { text, details } : { text };
}

export function createPiDurableGrepTool(cwd: string): ToolRegistration<typeof grepSchema> {
	return defineTool({
		name: "grep",
		replay: "safe",
		description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${GREP_DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		parameters: grepSchema,
		execute: async (args, api) => {
			const outcome = await runGrepSearch({
				cwd: api.env?.cwd ?? cwd,
				pattern: args.pattern,
				path: args.path,
				glob: args.glob,
				ignoreCase: args.ignoreCase,
				literal: args.literal,
				context: args.context,
				limit: args.limit,
			});
			return {
				content: [{ type: "text", text: outcome.text }],
				...(outcome.details !== undefined ? { details: outcome.details } : {}),
			};
		},
	});
}
