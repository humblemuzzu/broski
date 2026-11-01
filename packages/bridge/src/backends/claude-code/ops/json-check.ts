/** Strict JSON for the files Claude Code reads as JSON: a file that fails here is skipped whole by the CLI (research 05 fact 1). */

import { isRecord } from "../json";

export type ParsedObject = { readonly value: Record<string, unknown> } | { readonly problem: string };

/** The top-level object of `text`, or why it is not one the CLI would accept. Never repairs anything. */
export function parseObject(text: string): ParsedObject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch (error) {
		return { problem: error instanceof Error ? error.message : "not valid JSON" };
	}
	return isRecord(parsed) ? { value: parsed } : { problem: "the top level must be a JSON object" };
}

export function jsonProblem(text: string): string | undefined {
	const parsed = parseObject(text);
	return "problem" in parsed ? parsed.problem : undefined;
}
