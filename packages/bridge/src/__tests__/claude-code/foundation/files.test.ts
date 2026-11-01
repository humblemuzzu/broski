import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../../../backends/claude-code/files/atomic-write";
import { indentOf, jsonFileText } from "../../../backends/claude-code/files/json-object";
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

	test("missing means no entry or a parent that is a file, nothing else", () => {
		expect(isMissing(Object.assign(new Error("x"), { code: "ENOENT" }))).toBe(true);
		expect(isMissing(Object.assign(new Error("x"), { code: "ENOTDIR" }))).toBe(true);
		expect(isMissing(Object.assign(new Error("x"), { code: "EACCES" }))).toBe(false);
		expect(isMissing("ENOENT")).toBe(false);
	});
});
