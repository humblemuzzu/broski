/** Strict JSON for the files Claude Code reads as JSON: the CLI skips a settings file that fails here whole. */

import { isRecord } from "../json";

export type ParsedObject = { readonly value: Record<string, unknown> } | { readonly problem: string };

/** The top-level object of `text` (a leading BOM allowed), or why it is not one the CLI would accept. Never repairs. */
export function parseObject(text: string): ParsedObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(withoutBom(text));
	} catch (error) {
		return { problem: error instanceof Error ? error.message : "not valid JSON" };
	}
	return isRecord(parsed) ? { value: parsed } : { problem: "the top level must be a JSON object" };
}

/** The file's own indentation; a file written on one line stays on one line, and a new file gets two spaces. */
export function indentOf(text: string): string | undefined {
	if (text.trim() === "" || text.trim() === "{}") return "  ";
	if (!text.trim().includes("\n")) return undefined;
	return /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
}

/** `value` as the file's text: in the indentation `indentOf` found, ending with a newline. */
export function jsonFileText(value: unknown, indent: string | undefined): string {
	return `${JSON.stringify(value, null, indent)}\n`;
}

function withoutBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
