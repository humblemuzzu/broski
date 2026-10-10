import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	COLLAB_CACHE_MAX_ENTRIES,
	getAllCollabRelations,
	getCollabChildren,
	recordCollabSpawn,
	setCollabCachePath,
} from "../connectors/codex/cx-collab-cache";

let tmpDirs: string[] = [];

async function makeCache(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-collab-cache-"));
	tmpDirs.push(dir);
	const path = join(dir, "nested", "collab-cache.json");
	setCollabCachePath(path);
	return path;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

async function writeCacheFile(path: string, body: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body);
}

afterEach(async () => {
	setCollabCachePath(null);
	for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
	tmpDirs = [];
});

describe("codex collab cache", () => {
	test("keeps the newest relations once the cap is reached", async () => {
		const path = await makeCache();
		const total = COLLAB_CACHE_MAX_ENTRIES + 20;

		for (let index = 0; index < total; index++) {
			recordCollabSpawn(`parent-${index}`, `child-${index}`, `nick-${index}`, "worker", `prompt ${index}`);
		}

		const relations = getAllCollabRelations();
		expect(relations).toHaveLength(COLLAB_CACHE_MAX_ENTRIES);
		expect(relations.some((relation) => relation.childThreadId === `child-${total - 1}`)).toBe(true);
		expect(relations.some((relation) => relation.childThreadId === "child-0")).toBe(false);

		const stored: unknown = JSON.parse(await readFile(path, "utf-8"));
		expect(Array.isArray(stored) ? stored.length : -1).toBe(COLLAB_CACHE_MAX_ENTRIES);
	});

	test("writes the file 0600 and leaves no temp file behind", async () => {
		const path = await makeCache();
		recordCollabSpawn("parent", "child", "nick", "worker", "prompt");

		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(await exists(`${path}.tmp`)).toBe(false);
	});

	test("reloads what it wrote", async () => {
		const path = await makeCache();
		recordCollabSpawn("parent", "child", "nick", "worker", "prompt");

		setCollabCachePath(path);
		expect(getCollabChildren("parent").map((relation) => relation.childThreadId)).toEqual(["child"]);
		expect(getAllCollabRelations()).toHaveLength(1);
	});

	test("starts fresh when the file is corrupt", async () => {
		const path = await makeCache();
		await writeCacheFile(path, "{ not json");

		expect(getAllCollabRelations()).toEqual([]);
		recordCollabSpawn("parent", "child");
		expect(getAllCollabRelations()).toHaveLength(1);
	});

	test("ignores entries that are not relations", async () => {
		const path = await makeCache();
		await writeCacheFile(
			path,
			`${JSON.stringify([{ parentThreadId: "p" }, { parentThreadId: "p", childThreadId: "c" }])}\n`,
		);

		expect(getAllCollabRelations()).toHaveLength(1);
	});

	test("never records the same pair twice", async () => {
		await makeCache();
		recordCollabSpawn("parent", "child");
		recordCollabSpawn("parent", "child");

		expect(getAllCollabRelations()).toHaveLength(1);
	});
});
