import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../../scripts/contract-gen/canonical-json";
import { contractConstants } from "../../scripts/contract-gen/constants";
import { compactLongStrings, expandLongStrings, RUNS_KEY } from "../../scripts/contract-gen/fixture-text";

describe("long strings in fixtures", () => {
	test("are written as code-point runs and expand back exactly", () => {
		const text = `${"😀".repeat(3000)}\ud83d${"a".repeat(2000)}`;
		const compacted = compactLongStrings({ text, short: "x" });
		expect(compacted).toEqual({
			text: {
				[RUNS_KEY]: [
					["😀", 3000],
					["\ud83d", 1],
					["a", 2000],
				],
			},
			short: "x",
		});
		expect(expandLongStrings(compacted)).toEqual({ text, short: "x" });
	});

	test("refuse a value that already uses the runs key", () => {
		expect(() => compactLongStrings({ [RUNS_KEY]: [] })).toThrow();
	});
});

describe("canonical JSON", () => {
	test("orders every key by code units, integer-like keys too, at any depth", () => {
		const value = { "10": 1, "2": [{ z: 1, Z: null }], a: { é: true, b: "x" } };
		expect(canonicalJson(value)).toBe('{"10":1,"2":[{"Z":null,"z":1}],"a":{"b":"x","é":true}}');
	});
});

describe("generated constants", () => {
	test("name every bound, the page bound and the core's request deadline", () => {
		const names = contractConstants().map(([name]) => name);
		expect(names).toContain("MAX_TEXT_CHARS");
		expect(names).toContain("MAX_PAGE_LIMIT");
		expect(names).toContain("REQUEST_DEADLINE_MS");
	});
});
