import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	appendFileSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE_BYTES, TranscriptTail } from "../../../backends/claude-code/terminal/tail";

let dir: string;
let path: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "broski-tail-"));
	path = join(dir, "s.jsonl");
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("TranscriptTail", () => {
	test("starts at the end: what the file held is baseline, what is appended after is news", async () => {
		writeFileSync(path, '{"n":1}\n{"n":2}\n');
		const tail = new TranscriptTail(path);
		expect(await tail.attach()).toEqual(['{"n":1}', '{"n":2}']);
		expect((await tail.read()).lines).toEqual([]);
		appendFileSync(path, '{"n":3}\n');
		expect((await tail.read()).lines).toEqual(['{"n":3}']);
	});

	test("a partial last line is held until its newline is written", async () => {
		writeFileSync(path, "");
		const tail = new TranscriptTail(path);
		await tail.attach();
		appendFileSync(path, '{"n":');
		expect((await tail.read()).lines).toEqual([]);
		appendFileSync(path, '4}\n{"n":5}\n');
		expect((await tail.read()).lines).toEqual(['{"n":4}', '{"n":5}']);
	});

	test("a truncated file is read again from its newest bytes", async () => {
		writeFileSync(path, '{"n":1}\n{"n":2}\n{"n":3}\n');
		const tail = new TranscriptTail(path);
		await tail.attach();
		truncateSync(path, 8);
		writeFileSync(path, '{"n":9}\n');
		const read = await tail.read();
		expect(read.reset).toBe(true);
		expect(read.lines).toEqual(['{"n":9}']);
	});

	test("a file replaced by another (a new inode) is read again", async () => {
		writeFileSync(path, '{"n":1}\n');
		const tail = new TranscriptTail(path);
		await tail.attach();
		writeFileSync(join(dir, "other"), '{"n":1}\n{"n":2}\n{"n":3}\n');
		renameSync(join(dir, "other"), path);
		const read = await tail.read();
		expect(read.reset).toBe(true);
		expect(read.lines).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
	});

	test("a reset window starts at a whole line, never in the middle of one", async () => {
		const line = `${JSON.stringify({ pad: "x".repeat(1_000) })}\n`;
		const count = Math.ceil((BASELINE_BYTES * 2) / line.length);
		writeFileSync(path, line.repeat(count));
		const tail = new TranscriptTail(path);
		const baseline = await tail.attach();
		expect(baseline.length).toBeGreaterThan(100);
		for (const entry of baseline) expect(JSON.parse(entry).pad).toHaveLength(1_000);
		expect(baseline.length).toBeLessThan(count);
	});

	test("a file that is gone is said to be gone, and one that comes back is read", async () => {
		const tail = new TranscriptTail(path);
		expect((await tail.read()).gone).toBe(true);
		writeFileSync(path, '{"n":1}\n');
		expect((await tail.read()).lines).toEqual(['{"n":1}']);
	});

	test("a burst larger than one read is read in several, none lost", async () => {
		writeFileSync(path, "");
		const tail = new TranscriptTail(path);
		await tail.attach();
		const line = `${JSON.stringify({ pad: "y".repeat(500_000) })}\n`;
		appendFileSync(path, line.repeat(20));
		const seen: string[] = [];
		for (let read = await tail.read(); ; read = await tail.read()) {
			seen.push(...read.lines);
			if (!read.more) break;
		}
		expect(seen).toHaveLength(20);
	});

	test("the tail path never reads a whole file", () => {
		const root = join(import.meta.dir, "../../../backends/claude-code/terminal");
		const notTheTail = new Set(["hook-install.ts"]);
		for (const name of readdirSync(root).filter((file) => !notTheTail.has(file))) {
			expect(readFileSync(join(root, name), "utf8"), name).not.toMatch(/readFile(Sync)?\(/);
		}
	});
});
