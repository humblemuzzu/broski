import { fieldProblem, type StringField, type StringFormat } from "../../src/contract";

function field(extra: { format?: StringFormat; pattern?: string }): StringField {
	return { kind: "string", key: "k", required: false, hidden: false, when: [], options: [], allowCustom: false, ...extra };
}

/**
 * One corpus line: `text` judged by the contract's own `fieldProblem` under Bun. `kind` says what
 * the line is about, for a sweep to be tallied by.
 */
export function corpusLine(
	check: string,
	text: string,
	extra: { format?: StringFormat; pattern?: string },
	kind?: string,
): string {
	const problem = fieldProblem(field(extra), { kind: "text", value: text }) ?? null;
	return JSON.stringify({ check, text, pattern: extra.pattern, problem, ...(kind !== undefined && { kind }) });
}
