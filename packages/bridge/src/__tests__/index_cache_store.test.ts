import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INDEX_CACHE_FILE_MODE, readIndexCacheLines, writeIndexCacheLines } from "../index-cache/index-cache-store";

type Entry = { key: string; value: number };

const SCHEMA = 3;
const MAX_BYTES = 4096;

let tmpDirs: string[] = [];

async function makeStorePath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-index-store-"));
	tmpDirs.push(dir);
	return join(dir, "index.jsonl");
}

function parseEntry(line: string): Entry | null {
	try {
		const parsed: unknown = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null) return null;
		const record = parsed as Record<string, unknown>;
		if (typeof record.key !== "string" || typeof record.value !== "number") return null;
		return { key: record.key, value: record.value };
	} catch {
		return null;
	}
}

const read = (path: string): Promise<Entry[]> =>
	readIndexCacheLines({ path, schema: SCHEMA, maxBytes: MAX_BYTES }, parseEntry);

afterEach(async () => {
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

describe("index cache store", () => {
	test("a missing file reads as empty instead of throwing", async () => {
		expect(await read(await makeStorePath())).toEqual([]);
	});

	test("round-trips records in the order they were written", async () => {
		const path = await makeStorePath();
		await writeIndexCacheLines({ path, schema: SCHEMA, maxBytes: MAX_BYTES }, [
			JSON.stringify({ key: "b", value: 2 }),
			JSON.stringify({ key: "a", value: 1 }),
		]);
		expect(await read(path)).toEqual([
			{ key: "b", value: 2 },
			{ key: "a", value: 1 },
		]);
	});

	test("writes the file 0600 inside a directory only the owner can read", async () => {
		const path = await makeStorePath();
		await writeIndexCacheLines({ path, schema: SCHEMA, maxBytes: MAX_BYTES }, [JSON.stringify({ key: "a", value: 1 })]);
		const file = await stat(path);
		expect(file.mode & 0o777).toBe(INDEX_CACHE_FILE_MODE);
		const dir = await stat(join(path, ".."));
		expect(dir.mode & 0o777).toBe(0o700);
	});

	test("drops a file written by another schema version", async () => {
		const path = await makeStorePath();
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, `${JSON.stringify({ schema: SCHEMA - 1 })}\n${JSON.stringify({ key: "a", value: 1 })}\n`);
		expect(await read(path)).toEqual([]);
	});

	test("keeps the records around a corrupt line and drops the line", async () => {
		const path = await makeStorePath();
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(
			path,
			`${JSON.stringify({ schema: SCHEMA })}\n{"key":"a","value":1}\n{"key":"b","valu\n{"key":"c","value":3}\n`,
		);
		expect(await read(path)).toEqual([
			{ key: "a", value: 1 },
			{ key: "c", value: 3 },
		]);
	});

	test("reads as empty when the header itself is corrupt", async () => {
		const path = await makeStorePath();
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, `not json\n{"key":"a","value":1}\n`);
		expect(await read(path)).toEqual([]);
	});

	test("drops a file larger than the byte budget rather than loading it", async () => {
		const path = await makeStorePath();
		await writeIndexCacheLines({ path, schema: SCHEMA, maxBytes: MAX_BYTES }, [JSON.stringify({ key: "a", value: 1 })]);
		expect((await read(path)).length).toBe(1);
		expect(await readIndexCacheLines({ path, schema: SCHEMA, maxBytes: 8 }, parseEntry)).toEqual([]);
	});

	test("keeps the longest prefix of the records that fits the budget", async () => {
		const path = await makeStorePath();
		const lines = Array.from({ length: 200 }, (_, index) => JSON.stringify({ key: `k${index}`, value: index }));
		const written = await writeIndexCacheLines({ path, schema: SCHEMA, maxBytes: 512 }, lines);

		expect(written).toBeGreaterThan(0);
		expect(written).toBeLessThan(lines.length);
		const kept = await read(path);
		expect(kept.length).toBe(written);
		expect(kept.map((entry) => entry.key)).toEqual(lines.slice(0, written).map((line) => parseEntry(line)?.key ?? ""));
		expect((await stat(path)).size).toBeLessThanOrEqual(512);
	});

	test("reports a failed write and leaves the existing file in place", async () => {
		const path = await makeStorePath();
		await writeIndexCacheLines({ path, schema: SCHEMA, maxBytes: MAX_BYTES }, [JSON.stringify({ key: "a", value: 1 })]);
		const before = await readFile(path, "utf-8");

		const written = await writeIndexCacheLines(
			{ path: join(path, "nested", "index.jsonl"), schema: SCHEMA, maxBytes: MAX_BYTES },
			[JSON.stringify({ key: "b", value: 2 })],
		);

		expect(written).toBe(0);
		expect(await readFile(path, "utf-8")).toBe(before);
	});
});
