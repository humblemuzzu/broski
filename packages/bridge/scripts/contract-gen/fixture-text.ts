import { isDeepStrictEqual } from "node:util";
import type { JsonValue } from "../../src/contract";

/** The fixture key that stands for a long string written as runs of one code point. */
export const RUNS_KEY = "$runs";

/** Strings longer than this are written as runs, so a megabyte of text costs a few bytes of fixture. */
const LONG_STRING = 4_096;

/**
 * `value` with every long string written as `{"$runs": [[codePoint, count], …]}`: consecutive equal
 * code points (a lone surrogate counts as one) collapse into one run. The app expands it before it
 * decodes anything. Throws unless the result expands back to exactly `value`.
 */
export function compactLongStrings(value: JsonValue): JsonValue {
	const compacted = compact(value);
	if (!isDeepStrictEqual(expandLongStrings(compacted), value)) throw new Error("the long-string codec lost data");
	return compacted;
}

export function expandLongStrings(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(expandLongStrings);
	if (value === null || typeof value !== "object") return value;
	const runs = value[RUNS_KEY];
	if (runs !== undefined) {
		if (!Array.isArray(runs)) throw new Error(`${RUNS_KEY} is not a list`);
		return runs
			.map((run) => {
				if (!Array.isArray(run) || typeof run[0] !== "string" || typeof run[1] !== "number") {
					throw new Error(`a run is [codePoint, count], not ${JSON.stringify(run)}`);
				}
				return run[0].repeat(run[1]);
			})
			.join("");
	}
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandLongStrings(item)]));
}

function compact(value: JsonValue): JsonValue {
	if (typeof value === "string") return value.length > LONG_STRING ? { [RUNS_KEY]: runsOf(value) } : value;
	if (Array.isArray(value)) return value.map(compact);
	if (value === null || typeof value !== "object") return value;
	if (RUNS_KEY in value) throw new Error(`a fixture value already has a ${RUNS_KEY} key`);
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compact(item)]));
}

function runsOf(text: string): [string, number][] {
	const runs: [string, number][] = [];
	for (const codePoint of text) {
		const last = runs.at(-1);
		if (last && last[0] === codePoint) last[1] += 1;
		else runs.push([codePoint, 1]);
	}
	return runs;
}
