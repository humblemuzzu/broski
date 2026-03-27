import { afterEach, describe, expect, it } from "bun:test";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTailer } from "../file-tailer";

const TMP = join(tmpdir(), `file-tailer-test-${Date.now()}`);

async function setup() {
	await mkdir(TMP, { recursive: true });
}

async function cleanup() {
	await rm(TMP, { recursive: true, force: true });
}

describe("FileTailer", () => {
	afterEach(cleanup);

	it("calls bootstrapBaseline then emits only NEW lines via processRecord", async () => {
		await setup();
		const filePath = join(TMP, "test.jsonl");

		// Write initial content (baseline — consumed by bootstrap, NOT processRecord)
		await writeFile(filePath, '{"type":"old","n":1}\n');

		const records: unknown[] = [];
		let baselineCalled = false;

		const tailer = new FileTailer({
			label: "test",
			resolveFilePath: async () => filePath,
			processRecord: (parsed) => {
				records.push(parsed);
			},
			bootstrapBaseline: async () => {
				baselineCalled = true;
			},
			pollIntervalMs: 50,
		});

		tailer.start();

		// Wait for initial pump — bootstrap reads existing content, offset = file size
		await new Promise((r) => setTimeout(r, 200));
		expect(baselineCalled).toBe(true);
		expect(tailer.initialSyncDone).toBe(true);

		// No records yet — old content was handled by bootstrap, not processRecord
		expect(records.length).toBe(0);

		// Append new lines
		await appendFile(filePath, '{"type":"new","n":2}\n{"type":"new","n":3}\n');

		// Wait for poll to pick it up
		await new Promise((r) => setTimeout(r, 300));

		// Only the two NEW records should appear
		expect(records.length).toBe(2);
		expect((records[0] as any).n).toBe(2);
		expect((records[1] as any).n).toBe(3);

		tailer.stop();
	});

	it("processes all lines when file starts empty", async () => {
		await setup();
		const filePath = join(TMP, "empty.jsonl");
		await writeFile(filePath, "");

		const records: unknown[] = [];

		const tailer = new FileTailer({
			label: "empty-test",
			resolveFilePath: async () => filePath,
			processRecord: (parsed) => records.push(parsed),
			pollIntervalMs: 50,
		});

		tailer.start();
		await new Promise((r) => setTimeout(r, 200));
		expect(tailer.initialSyncDone).toBe(true);

		await appendFile(filePath, '{"a":1}\n{"a":2}\n');
		await new Promise((r) => setTimeout(r, 300));

		expect(records.length).toBe(2);
		expect((records[0] as any).a).toBe(1);

		tailer.stop();
	});

	it("handles file truncation gracefully", async () => {
		await setup();
		const filePath = join(TMP, "trunc.jsonl");
		await writeFile(filePath, '{"x":1}\n{"x":2}\n{"x":3}\n');

		let resetCount = 0;
		const records: unknown[] = [];

		const tailer = new FileTailer({
			label: "trunc-test",
			resolveFilePath: async () => filePath,
			processRecord: (parsed) => records.push(parsed),
			onReset: () => {
				resetCount++;
			},
			pollIntervalMs: 50,
		});

		tailer.start();
		await new Promise((r) => setTimeout(r, 200));
		expect(tailer.initialSyncDone).toBe(true);

		// Truncate the file (smaller than offset)
		await writeFile(filePath, '{"x":99}\n');
		await new Promise((r) => setTimeout(r, 300));

		expect(resetCount).toBeGreaterThanOrEqual(1);
		// After reset + re-read, the new content should be processed
		const last = records[records.length - 1] as any;
		expect(last.x).toBe(99);

		tailer.stop();
	});

	it("does not resolve file if resolveFilePath returns null", async () => {
		const records: unknown[] = [];
		const tailer = new FileTailer({
			label: "null-test",
			resolveFilePath: async () => null,
			processRecord: (parsed) => records.push(parsed),
			pollIntervalMs: 50,
		});

		tailer.start();
		await new Promise((r) => setTimeout(r, 200));

		expect(tailer.initialSyncDone).toBe(false);
		expect(records.length).toBe(0);

		tailer.stop();
	});

	it("stop() is idempotent", () => {
		const tailer = new FileTailer({
			label: "stop-test",
			resolveFilePath: async () => null,
			processRecord: () => {},
		});
		tailer.start();
		tailer.stop();
		tailer.stop(); // should not throw
	});

	it("skips malformed JSON lines without crashing", async () => {
		await setup();
		const filePath = join(TMP, "bad.jsonl");
		await writeFile(filePath, "");

		const records: unknown[] = [];
		const tailer = new FileTailer({
			label: "bad-json",
			resolveFilePath: async () => filePath,
			processRecord: (parsed) => records.push(parsed),
			pollIntervalMs: 50,
		});

		tailer.start();
		await new Promise((r) => setTimeout(r, 150));

		await appendFile(filePath, 'not json\n{"ok":true}\n{broken\n{"ok2":true}\n');
		await new Promise((r) => setTimeout(r, 300));

		// Only valid JSON lines should appear
		expect(records.length).toBe(2);
		expect((records[0] as any).ok).toBe(true);
		expect((records[1] as any).ok2).toBe(true);

		tailer.stop();
	});
});
