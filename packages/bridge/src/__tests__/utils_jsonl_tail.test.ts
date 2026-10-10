import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonlTail } from "../utils/jsonl-tail";

let tmpDirs: string[] = [];

async function writeFileInTmp(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-jsonl-tail-"));
	tmpDirs.push(dir);
	const path = join(dir, "a.jsonl");
	await writeFile(path, content);
	return path;
}

afterEach(async () => {
	await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	tmpDirs = [];
});

const referenceTail = (content: string, maxLines: number): string[] => {
	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line)).slice(-maxLines);
};

describe("readJsonlTail", () => {
	it("returns the last maxLines lines", async () => {
		const path = await writeFileInTmp("a\nb\nc\nd\n");
		expect(await readJsonlTail(path, { maxLines: 2 })).toEqual(["c", "d"]);
	});

	it("handles a missing trailing newline", async () => {
		const path = await writeFileInTmp("a\nb\nc");
		expect(await readJsonlTail(path, { maxLines: 2 })).toEqual(["b", "c"]);
	});

	it("handles CRLF", async () => {
		const path = await writeFileInTmp("a\r\nb\r\nc\r\n");
		expect(await readJsonlTail(path, { maxLines: 2 })).toEqual(["b", "c"]);
	});

	it("returns an empty array for an empty file", async () => {
		const path = await writeFileInTmp("");
		expect(await readJsonlTail(path, { maxLines: 5 })).toEqual([]);
	});

	it("reads a file smaller than one chunk", async () => {
		const path = await writeFileInTmp("a\nb\nc\n");
		expect(await readJsonlTail(path, { maxLines: 10, chunkSize: 1024 })).toEqual(["a", "b", "c"]);
	});

	it("reads lines longer than a chunk", async () => {
		const path = await writeFileInTmp("aaaaaa\nbbbbbb\n");
		expect(await readJsonlTail(path, { maxLines: 1, chunkSize: 4 })).toEqual(["bbbbbb"]);
	});

	it("keeps multi-byte characters split across chunk boundaries", async () => {
		const path = await writeFileInTmp("é\n");
		expect(await readJsonlTail(path, { maxLines: 1, chunkSize: 1 })).toEqual(["é"]);
		const emoji = await writeFileInTmp("a😀\n");
		expect(await readJsonlTail(emoji, { maxLines: 1, chunkSize: 1 })).toEqual(["a😀"]);
	});

	it("caps the read by maxBytes and returns only complete lines", async () => {
		const path = await writeFileInTmp("aaaa\nbbbb\ncccc\n");
		expect(await readJsonlTail(path, { maxLines: 2, maxBytes: 5 })).toEqual(["cccc"]);
	});

	it("returns no more than maxLines even when the suffix holds more", async () => {
		const path = await writeFileInTmp("a\nb\nc\nd\ne\n");
		expect(await readJsonlTail(path, { maxLines: 2, chunkSize: 1024 })).toEqual(["d", "e"]);
	});

	it("yields a single empty line for a lone newline", async () => {
		const path = await writeFileInTmp("\n");
		expect(await readJsonlTail(path, { maxLines: 3 })).toEqual([""]);
	});

	it("matches a whole-file split across random content and chunk sizes", async () => {
		const tokens = ["a", "b", "é", "😀", "✓", "\n", "\r\n", ""];
		let seed = 1;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed;
		};
		for (let trial = 0; trial < 40; trial++) {
			let content = "";
			const tokenCount = 1 + (next() % 30);
			for (let index = 0; index < tokenCount; index++) content += tokens[next() % tokens.length]!;
			const path = await writeFileInTmp(content);
			for (const chunkSize of [1, 2, 3, 5, 7, 64]) {
				for (const maxLines of [1, 2, 3, 5]) {
					const actual = await readJsonlTail(path, { maxLines, chunkSize });
					const expected = referenceTail(content, maxLines);
					expect(actual, `content=${JSON.stringify(content)} chunkSize=${chunkSize} maxLines=${maxLines}`).toEqual(
						expected,
					);
				}
			}
		}
	});
});
