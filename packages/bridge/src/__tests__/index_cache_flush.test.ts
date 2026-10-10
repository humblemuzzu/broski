import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIndexCacheLines, writeIndexCacheLines } from "../index-cache/index-cache-store";
import { PiSessionIndex } from "../index-cache/pi-session-index";
import {
	PI_SESSION_INDEX_FILE,
	PI_SESSION_INDEX_MAX_BYTES,
	PI_SESSION_INDEX_SCHEMA,
	type PiSessionIndexRecord,
	parsePiSessionIndexRecord,
} from "../index-cache/pi-session-index-record";

let tmpDirs: string[] = [];

async function makeDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-index-flush-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

const STAMP_BASE = 1_700_000_000_000;

function makeRecord(n: number): PiSessionIndexRecord {
	return {
		path: `/sessions/session-${n}.jsonl`,
		mtimeMs: STAMP_BASE + n,
		size: 100 + n,
		ino: n + 1,
		ctimeMs: STAMP_BASE + n,
		id: `id-${n}`,
		cwd: "/work",
		created: STAMP_BASE,
		modified: STAMP_BASE + n,
		messageCount: 1,
		firstMessage: `first ${n}`,
		at: STAMP_BASE + n,
	};
}

function makeRecords(count: number, offset = 0): PiSessionIndexRecord[] {
	return Array.from({ length: count }, (_, index) => makeRecord(offset + index));
}

const indexOptions = (path: string) => ({
	path,
	schema: PI_SESSION_INDEX_SCHEMA,
	maxBytes: PI_SESSION_INDEX_MAX_BYTES,
});

const indexPath = (dir: string): string => join(dir, PI_SESSION_INDEX_FILE);

const readRecords = (path: string): Promise<PiSessionIndexRecord[]> =>
	readIndexCacheLines(indexOptions(path), parsePiSessionIndexRecord);

const parseEntry = (line: string): { key: string } | null => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const key = (parsed as { key?: unknown }).key;
	return typeof key === "string" ? { key } : null;
};

describe("pi session index flush", () => {
	test("keeps every record when the write cannot happen", async () => {
		const dir = await makeDir();
		const blocker = join(dir, "not-a-directory");
		await writeFile(blocker, "x");
		const index = new PiSessionIndex(indexOptions(join(blocker, PI_SESSION_INDEX_FILE)), makeRecords(5));
		index.put(makeRecord(5));
		expect(index.size).toBe(6);

		expect(await index.flush()).toBe(false);
		expect(index.size).toBe(6);

		// The records are still dirty, so the next flush retries them instead of considering them written.
		expect(await index.flush()).toBe(false);
		expect(index.size).toBe(6);
	});

	test("two concurrent flushes keep the index and every record", async () => {
		const dir = await makeDir();
		const n = 30_000;
		const index = new PiSessionIndex(indexOptions(indexPath(dir)), makeRecords(n - 1));
		index.put(makeRecord(n - 1));
		expect(index.size).toBe(n);

		const results = await Promise.all([index.flush(), index.flush()]);

		expect(results).toEqual([true, true]);
		expect(index.size).toBe(n);
		expect((await readRecords(indexPath(dir))).length).toBe(n);
	});

	test("two concurrent writes to one file both land", async () => {
		const dir = await makeDir();
		const path = indexPath(dir);
		const options = { path, schema: PI_SESSION_INDEX_SCHEMA, maxBytes: PI_SESSION_INDEX_MAX_BYTES };

		const [a, b] = await Promise.all([
			writeIndexCacheLines(options, [JSON.stringify({ key: "a" })]),
			writeIndexCacheLines(options, [JSON.stringify({ key: "b" })]),
		]);

		expect(a).toBeGreaterThan(0);
		expect(b).toBeGreaterThan(0);
		expect((await readIndexCacheLines(options, parseEntry)).length).toBe(1);
	});

	test("a flush keeps the records another index wrote to the same file", async () => {
		const dir = await makeDir();
		const path = indexPath(dir);
		const options = indexOptions(path);
		const first = new PiSessionIndex(options, await readRecords(path));
		const second = new PiSessionIndex(options, await readRecords(path));

		const mine = makeRecord(0);
		const theirs = makeRecord(100);
		first.put(mine);
		await first.flush();
		second.put(theirs);
		await second.flush();

		expect((await readRecords(path)).map((record) => record.path).sort()).toEqual([
			"/sessions/session-0.jsonl",
			"/sessions/session-100.jsonl",
		]);
	});
});
