import { homedir } from "node:os";
import type { FileContent, FileStatusInfo, SymbolResult, TextSearchResult } from "../../types";
import type { OpenCodeContext } from "./context";
import { lspSymbolKindToString } from "./mappers";

export async function listFiles(ctx: OpenCodeContext, path: string, directory?: string) {
	const resolvedPath = path === "~" || path.startsWith("~/") ? path.replace(/^~/, homedir()) : path;

	const { data } = await ctx.client.file.list({ path: resolvedPath, directory });
	return data;
}

export async function readFile(ctx: OpenCodeContext, path: string, directory?: string): Promise<FileContent> {
	try {
		const { data: result } = await ctx.client.file.read({ path, directory });
		const mimeType = result?.mimeType ?? "text/plain";

		return {
			type: result?.type === "binary" ? "binary" : "text",
			content: result?.content ?? "",
			mime: mimeType,
			mimeType,
			encoding: result?.encoding,
			diff: result?.diff,
			patch: result?.patch,
		};
	} catch {
		return { type: "text", content: "", mime: "text/plain", mimeType: "text/plain" };
	}
}

export async function findFiles(ctx: OpenCodeContext, query: string, directory?: string): Promise<string[]> {
	try {
		const { data: result } = await ctx.client.find.files({ query, directory });
		return result ?? [];
	} catch {
		return [];
	}
}

export async function searchFilesAndDirs(
	ctx: OpenCodeContext,
	query: string,
	directory?: string,
	limit: number = 20,
): Promise<string[]> {
	try {
		// `dirs` is a wire enum (`"true" | "false"`), not a boolean.
		const { data: result } = await ctx.client.find.files({ query, dirs: "true", directory, limit });
		return result ?? [];
	} catch {
		return [];
	}
}

export async function findText(
	ctx: OpenCodeContext,
	pattern: string,
	include?: string,
	directory?: string,
): Promise<TextSearchResult[]> {
	try {
		const { data: result } = await ctx.client.find.text({ pattern, directory });

		let mapped = (result ?? []).map((item: any) => ({
			path: item.path?.text ?? item.path ?? "",
			lineNumber: item.line_number ?? item.lineNumber ?? 0,
			lineText: item.lines?.text ?? "",
			matches: (item.submatches ?? []).map((m: any) => ({
				text: m.match?.text ?? "",
				start: m.start ?? 0,
				end: m.end ?? 0,
			})),
		}));

		// `include` is not supported by SDK v2 find.text(); keep best-effort
		// client-side filtering for backward compatibility.
		if (include && include.trim().length > 0) {
			const normalized = include.trim().toLowerCase();
			mapped = mapped.filter((entry) => entry.path.toLowerCase().includes(normalized));
		}

		return mapped;
	} catch {
		return [];
	}
}

export async function findSymbols(ctx: OpenCodeContext, query: string, directory?: string): Promise<SymbolResult[]> {
	try {
		const { data: result } = await ctx.client.find.symbols({ query, directory });
		return (result ?? []).map((item: any) => ({
			name: item.name ?? "",
			kind: lspSymbolKindToString(item.kind),
			path: item.path ?? item.location?.uri ?? "",
			line: item.line ?? item.location?.range?.start?.line ?? 0,
			column: item.column ?? item.location?.range?.start?.character ?? 0,
		}));
	} catch {
		return [];
	}
}

export async function getFileStatus(ctx: OpenCodeContext, directory?: string): Promise<FileStatusInfo[]> {
	try {
		const { data: result } = await ctx.client.file.status({ directory });
		return (result ?? []).map((f: any) => ({
			path: f.path ?? "",
			added: typeof f.added === "number" ? f.added : 0,
			removed: typeof f.removed === "number" ? f.removed : 0,
			status: f.status ?? "modified",
		}));
	} catch {
		return [];
	}
}
