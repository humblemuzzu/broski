import * as limits from "../../src/contract/limits";
import { MAX_PAGE_LIMIT } from "../../src/contract/paging";
import { REQUEST_DEADLINE_MS } from "../../src/core/protocol-server";
import { byCodeUnits } from "./order";

/**
 * The numbers the app must agree with the bridge on, keyed by their TypeScript name: every bound in
 * `limits.ts`, the page bound, and how long the bridge core may take to answer a request (after
 * which it answers `internal` itself), so the app's wait follows the core's.
 */
export function contractConstants(): [string, number][] {
	const named: Record<string, number> = { ...limits, MAX_PAGE_LIMIT, REQUEST_DEADLINE_MS };
	return Object.entries(named).sort(([a], [b]) => byCodeUnits(a, b));
}

/** `MAX_TEXT_CHARS` → `contractMaxTextChars`. */
export function dartConstantName(name: string): string {
	if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name)) throw new Error(`not a SCREAMING_CASE constant: ${name}`);
	const words = name.toLowerCase().split("_");
	return `contract${words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")}`;
}

export function dartConstants(constants: [string, number][]): string {
	return constants
		.map(([name, value]) => {
			if (!Number.isSafeInteger(value)) throw new Error(`${name} is not an integer`);
			return `const int ${dartConstantName(name)} = ${value};\n`;
		})
		.join("");
}
