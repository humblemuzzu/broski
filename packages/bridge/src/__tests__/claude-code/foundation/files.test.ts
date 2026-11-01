import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../../../backends/claude-code/files/atomic-write";
import { indentOf, jsonFileText } from "../../../backends/claude-code/files/json-object";
import { roundTripProblem } from "../../../backends/claude-code/files/json-round-trip";
import { isMissing } from "../../../backends/claude-code/files/missing";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "broski-cc-files-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("the one atomic writer", () => {
	test("writes the exact mode, creates the parent, and leaves no temporary file", async () => {
		const path = join(root, "made", "here.json");
		expect(await writeAtomic(path, "{}\n", { mode: 0o600, dirMode: 0o700 })).toBe(true);
		expect(readFileSync(path, "utf8")).toBe("{}\n");
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(join(root, "made")).mode & 0o777).toBe(0o700);
		expect(readdirSync(join(root, "made"))).toEqual(["here.json"]);
	});

	test("a write no longer wanted leaves the old file whole and no temporary file", async () => {
		const path = join(root, "kept.json");
		writeFileSync(path, "old");
		expect(await writeAtomic(path, "new", { stillWanted: async () => false })).toBe(false);
		expect(readFileSync(path, "utf8")).toBe("old");
		expect(readdirSync(root)).toEqual(["kept.json"]);
	});
});

describe("the shared json and error helpers", () => {
	test("indentation: kept from the file, one line stays one line, a new file gets two spaces", () => {
		expect(indentOf('{\n\t"a": 1\n}')).toBe("\t");
		expect(indentOf('{"a": 1}')).toBeUndefined();
		expect(indentOf("")).toBe("  ");
		expect(jsonFileText({ a: 1 }, undefined)).toBe('{"a":1}\n');
	});

	test("a rewrite that keeps every value passes; a key written twice or a number a double loses does not", () => {
		const kept = [
			'{"a": 1, "b": {"a": 2}, "c": [{"a": 3}, {"a": 4}]}',
			'{"n": [1.0, 1e2, -0, 0.1, 1.5E-3, 9007199254740991, 123456789012345680000]}',
			'{"s": "a \\" , : { [ 1e400", "a\\u0063": 1, "ab": 2}',
		];
		for (const text of kept) expect(roundTripProblem(text)).toBeUndefined();
		expect(roundTripProblem('{"a": 1, "b": 2, "a": 3}')).toContain('"a" is written twice');
		expect(roundTripProblem('{"x": {"ab": 1, "a\\u0062": 2}}')).toContain("written twice");
		expect(roundTripProblem('{"n": 1e400}')).toContain("1e400");
		expect(roundTripProblem('{"n": 12345678901234567890}')).toContain("12345678901234567890");
		expect(roundTripProblem('{"n": 0.1000000000000000055511151231257827}')).toContain("cannot be written back");
	});

	test("missing means no entry or a parent that is a file, nothing else", () => {
		expect(isMissing(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true);
		expect(isMissing(Object.assign(new Error("x"), { code: "ENOTDIR" }))).toBe(true);
		expect(isMissing(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false);
		expect(isMissing("ENOENT")).toBe(false);
	});
});
