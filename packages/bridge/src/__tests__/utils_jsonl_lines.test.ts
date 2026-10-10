import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ReadJsonlLinesOptions, readJsonlHead, readJsonlLines } from "../utils/jsonl-lines";

let tmpDirs: string[] = [];

async function writeFileInTmp(name: string, content: string | Uint8Array): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-jsonl-lines-"));
	tmpDirs.push(dir);
	const path = join(dir, name);
	await writeFile(path, content);
	return path;
}

afterEach(async () => {
	await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	tmpDirs = [];
});

async function collect(path: string, options?: ReadJsonlLinesOptions): Promise<string[]> {
	const lines: string[] = [];
	for await (const line of readJsonlLines(path, options)) lines.push(line);
	return lines;
}

describe("readJsonlLines", () => {
	it("yields lines without their terminator", async () => {
		const path = await writeFileInTmp("a.jsonl", "a\nb\nc\n");
		expect(await collect(path)).toEqual(["a", "b", "c"]);
	});

	it("strips CRLF", async () => {
		const path = await writeFileInTmp("a.jsonl", "a\r\nb\r\nc");
		expect(await collect(path)).toEqual(["a", "b", "c"]);
	});

	it("yields a final line without a trailing newline", async () => {
		const path = await writeFileInTmp("a.jsonl", "a\nb");
		expect(await collect(path)).toEqual(["a", "b"]);
	});

	it("yields empty lines but not the one after a trailing newline", async () => {
		const path = await writeFileInTmp("a.jsonl", "\n\na\n\n");
		expect(await collect(path)).toEqual(["", "", "a", ""]);
	});

	it("yields nothing for an empty file", async () => {
		const path = await writeFileInTmp("a.jsonl", "");
		expect(await collect(path)).toEqual([]);
	});

	it("keeps a line longer than the internal chunk size intact", async () => {
		const long = "x".repeat(1_000_000);
		const path = await writeFileInTmp("a.jsonl", `${long}\nafter\n`);
		const lines = await collect(path);
		expect(lines).toEqual([long, "after"]);
	});

	it("stops at maxBytes", async () => {
		const path = await writeFileInTmp("a.jsonl", "aaaa\nbbbb\ncccc\n");
		expect(await collect(path, { maxBytes: 9 })).toEqual(["aaaa", "bbbb"]);
	});

	it("starts at startOffset, yielding a partial first line", async () => {
		const path = await writeFileInTmp("a.jsonl", "aaaa\nbbbb\ncccc\n");
		expect(await collect(path, { startOffset: 5 })).toEqual(["bbbb", "cccc"]);
		expect(await collect(path, { startOffset: 2 })).toEqual(["aa", "bbbb", "cccc"]);
	});

	it("rejects on a missing file", async () => {
		await expect(collect(join(tmpdir(), "broski-missing-jsonl-xyz"))).rejects.toThrow();
	});

	it("honours an aborted signal", async () => {
		const path = await writeFileInTmp("a.jsonl", "a\nb\n");
		const controller = new AbortController();
		controller.abort();
		await expect(collect(path, { signal: controller.signal })).rejects.toThrow();
	});

	it("round-trips a real file with non-ASCII content", async () => {
		const path = await writeFileInTmp("a.jsonl", "héllo wörld\nsecond ✓ line\n");
		expect(await collect(path)).toEqual(["héllo wörld", "second ✓ line"]);
	});

	it("reassembles multi-byte characters split across read-buffer boundaries", async () => {
		const path = await writeFileInTmp("a.jsonl", "héllo wörld\n😀 tail\n✓\n");
		expect(await collect(path, { chunkBytes: 1 })).toEqual(["héllo wörld", "😀 tail", "✓"]);
	});

	it("joins a CRLF split across read-buffer boundaries", async () => {
		const path = await writeFileInTmp("a.jsonl", "a\r\nb\r\n");
		expect(await collect(path, { chunkBytes: 1 })).toEqual(["a", "b"]);
	});

	it("replaces a dangling multi-byte sequence at EOF", async () => {
		const path = await writeFileInTmp("a.jsonl", Uint8Array.from([0xc3]));
		expect(await collect(path, { chunkBytes: 1 })).toEqual(["\uFFFD"]);
	});

	it("reads one byte at a time across a long line", async () => {
		const long = "α".repeat(500);
		const path = await writeFileInTmp("a.jsonl", `${long}\nend\n`);
		expect(await collect(path, { chunkBytes: 1 })).toEqual([long, "end"]);
	});
});

describe("readJsonlHead", () => {
	const CONTENT = '{"type":"session"}\n{"type":"user","text":"hi"}\n{"type":"assistant"}\n';

	it("returns the first maxLines lines", async () => {
		const path = await writeFileInTmp("a.jsonl", CONTENT);
		expect(await readJsonlHead(path, { maxLines: 2 })).toEqual(['{"type":"session"}', '{"type":"user","text":"hi"}']);
	});

	it("stops after the line that satisfies until, inclusively", async () => {
		const path = await writeFileInTmp("a.jsonl", CONTENT);
		expect(await readJsonlHead(path, { until: (line) => line.includes("user") })).toEqual([
			'{"type":"session"}',
			'{"type":"user","text":"hi"}',
		]);
		expect(await readJsonlHead(path, { until: (_line, index) => index === 0 })).toEqual(['{"type":"session"}']);
	});

	it("respects maxBytes and maxLines <= 0", async () => {
		const path = await writeFileInTmp("a.jsonl", CONTENT);
		expect(await readJsonlHead(path, { maxLines: 0 })).toEqual([]);
		expect(await readJsonlHead(path, { maxBytes: 18 })).toEqual(['{"type":"session"}']);
		expect(await readJsonlHead(path, { maxBytes: 17 })).toEqual(['{"type":"session"']);
	});
});
