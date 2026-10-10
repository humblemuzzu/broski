import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonlLineSpan, readJsonlLineSpans } from "../utils/jsonl-line-spans";
import { readJsonlLines } from "../utils/jsonl-lines";

let tmpDirs: string[] = [];

async function writeFileInTmp(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-jsonl-fds-"));
	tmpDirs.push(dir);
	const path = join(dir, "a.jsonl");
	await writeFile(path, "a\nb\n");
	return path;
}

afterEach(async () => {
	await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	tmpDirs = [];
});

const openFileDescriptors = (): number => readdirSync("/dev/fd").length;

async function collectLines(path: string, options: { chunkBytes?: number }): Promise<string[]> {
	const lines: string[] = [];
	for await (const line of readJsonlLines(path, options)) lines.push(line);
	return lines;
}

async function collectSpans(
	path: string,
	options: { chunkBytes?: number; headBytes?: number },
): Promise<JsonlLineSpan[]> {
	const spans: JsonlLineSpan[] = [];
	for await (const span of readJsonlLineSpans(path, options)) spans.push(span);
	return spans;
}

describe("jsonl line readers with a buffer they cannot allocate", () => {
	it("closes the file when the line buffer is too large", async () => {
		const path = await writeFileInTmp();
		const before = openFileDescriptors();

		await expect(collectLines(path, { chunkBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow();

		expect(openFileDescriptors()).toBe(before);
	});

	it("closes the file when a span buffer is too large", async () => {
		const path = await writeFileInTmp();

		const beforeChunk = openFileDescriptors();
		await expect(collectSpans(path, { chunkBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow();
		expect(openFileDescriptors()).toBe(beforeChunk);

		const beforeHead = openFileDescriptors();
		await expect(collectSpans(path, { headBytes: Number.MAX_SAFE_INTEGER })).rejects.toThrow();
		expect(openFileDescriptors()).toBe(beforeHead);
	});
});
