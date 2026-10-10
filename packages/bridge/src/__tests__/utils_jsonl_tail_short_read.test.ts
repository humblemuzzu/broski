import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, open, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonlTail } from "../utils/jsonl-tail";

let tmpDirs: string[] = [];

async function writeFileInTmp(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-jsonl-short-"));
	tmpDirs.push(dir);
	const path = join(dir, "a.jsonl");
	await writeFile(path, content);
	return path;
}

afterEach(async () => {
	await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	tmpDirs = [];
});

/**
 * The handle a tail holds while the file shrinks under it: `stat` still reports the old size, and a
 * read past the new end returns fewer bytes than it was asked for.
 */
async function shrinkingHandle(path: string, keepBytes: number) {
	const handle = await open(path, "r");
	const sizeBefore = (await handle.stat()).size;
	await truncate(path, keepBytes);
	return {
		stat: async () => ({ size: sizeBefore }),
		read: (buffer: Buffer, offset: number, length: number, position: number) =>
			handle.read(buffer, offset, length, position),
		close: () => handle.close(),
	};
}

describe("readJsonlTail after a short read", () => {
	it("returns the bytes that were read, not the rest of the uninitialised buffer", async () => {
		const path = await writeFileInTmp("alpha\nbeta\nGAMMA\n");
		const handle = await shrinkingHandle(path, 13);

		expect(await readJsonlTail(path, { maxLines: 3, openHandle: async () => handle })).toEqual(["alpha", "beta", "GA"]);
	});

	it("keeps the lines before a short read intact and in order", async () => {
		const path = await writeFileInTmp("one\ntwo\nthree\nfour\nfive\nsix\n");
		const handle = await shrinkingHandle(path, 23);

		expect(await readJsonlTail(path, { maxLines: 4, chunkSize: 8, openHandle: async () => handle })).toEqual([
			"two",
			"three",
			"four",
			"five",
		]);
	});
});
