/** Strict JSON for a user's file: a top-level object or a reason, never a repair (a leading BOM is allowed). */

export type ParsedJsonObject = { readonly value: Record<string, unknown> } | { readonly problem: string };

export function parseJsonObject(text: string): ParsedJsonObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch (error) {
		return { problem: error instanceof Error ? error.message : "not valid JSON" };
	}
	return isJsonObject(parsed) ? { value: parsed } : { problem: "the top level must be a JSON object" };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The file's own indentation; a file written on one line stays on one line, and a new file gets two spaces. */
export function jsonIndentOf(text: string): string | undefined {
	if (text.trim() === "" || text.trim() === "{}") return "  ";
	if (!text.trim().includes("\n")) return undefined;
	return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}
