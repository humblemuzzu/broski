import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CATALOG_MAX_AGE_MS,
	CatalogCache,
	type CatalogEntry,
} from "../../../backends/claude-code/models/catalog-cache";
import { initAnswer } from "./rig";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-catalog-cache-"));
	dirs.push(dir);
	return dir;
}

function cacheAt(path: string, clock: { time: number }, cliPath = "/fake/claude"): CatalogCache {
	return new CatalogCache({ path, cliPath, now: () => clock.time });
}

function entry(clock: { time: number }, skills?: string[]): CatalogEntry {
	return { at: clock.time, init: initAnswer(), skills };
}

describe("the catalogue cache", () => {
	test("keeps an entry in memory, and in a private file that another cache reads back", async () => {
		const path = join(temp(), "state", "catalog.json");
		const clock = { time: 5_000 };
		const cache = cacheAt(path, clock);
		expect(await cache.get("/project")).toBeUndefined();
		await cache.set("/project", entry(clock, ["demo"]));
		expect((await cache.get("/project"))?.skills).toEqual(["demo"]);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const again = await cacheAt(path, clock).get("/project");
		expect(again?.init).toEqual(initAnswer());
		expect(again?.skills).toEqual(["demo"]);
		expect(again?.at).toBe(5_000);
	});

	test("forgets an answer after 24 hours", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		const cache = cacheAt(path, clock);
		await cache.set("/p", entry(clock));
		clock.time = CATALOG_MAX_AGE_MS - 1;
		expect(await cache.get("/p")).toBeDefined();
		clock.time = CATALOG_MAX_AGE_MS;
		expect(await cache.get("/p")).toBeUndefined();
		expect(await cacheAt(path, clock).get("/p")).toBeUndefined();
	});

	test("refresh replaces the answer and keeps the skills already known, but not stale ones", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		const cache = cacheAt(path, clock);
		await cache.refresh("/p", initAnswer());
		expect((await cache.get("/p"))?.skills).toBeUndefined();
		await cache.set("/p", entry(clock, ["demo"]));
		clock.time = 10;
		await cache.refresh("/p", initAnswer({ output_style: "Concise" }));
		const kept = await cache.get("/p");
		expect(kept?.skills).toEqual(["demo"]);
		expect(kept?.init.output_style).toBe("Concise");
		expect(kept?.at).toBe(10);
		clock.time = CATALOG_MAX_AGE_MS + 100;
		await cache.refresh("/p", initAnswer());
		expect((await cache.get("/p"))?.skills).toBeUndefined();
	});

	test("drops one cwd or all, durably, and writes nothing when there was nothing to drop", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		const cache = cacheAt(path, clock);
		await cache.drop("/p");
		expect(() => statSync(path)).toThrow();
		await cache.set("/a", entry(clock));
		await cache.set("/b", entry(clock));
		await cache.drop("/a");
		const second = cacheAt(path, clock);
		expect(await second.get("/a")).toBeUndefined();
		expect(await second.get("/b")).toBeDefined();
		await second.drop();
		expect(await cacheAt(path, clock).get("/b")).toBeUndefined();
	});

	test("ignores a file written for another binary, a corrupt one, and an entry it cannot read", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		await cacheAt(path, clock, "/old/claude").set("/p", entry(clock));
		expect(await cacheAt(path, clock, "/new/claude").get("/p")).toBeUndefined();

		writeFileSync(path, "{ not json");
		expect(await cacheAt(path, clock).get("/p")).toBeUndefined();

		const good = { cwd: "/good", at: 0, init: initAnswer() };
		const bad = { cwd: "/bad", at: 0, init: { commands: "nope" } };
		writeFileSync(path, JSON.stringify({ version: 1, cliPath: "/fake/claude", entries: [bad, good] }));
		const cache = cacheAt(path, clock);
		expect(await cache.get("/bad")).toBeUndefined();
		expect(await cache.get("/good")).toBeDefined();
	});

	test("keeps only the fields the SDK types, so a round trip adds nothing", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		const cache = cacheAt(path, clock);
		const withExtras = { ...initAnswer(), pid: 4242 };
		await cache.set("/p", { at: 0, init: withExtras, skills: [] });
		const stored = JSON.parse(readFileSync(path, "utf8"));
		expect(stored.entries[0].init.pid).toBe(4242);
		const read = await cacheAt(path, clock).get("/p");
		expect(read).toBeDefined();
		expect(read?.init).not.toHaveProperty("pid");
		expect(read?.init.account.apiProvider).toBe("firstParty");
		expect(read?.skills).toEqual([]);
	});

	test("holds 32 working folders, dropping the longest unused first", async () => {
		const path = join(temp(), "catalog.json");
		const clock = { time: 0 };
		const cache = cacheAt(path, clock);
		for (let at = 0; at < 40; at++) await cache.set(`/p${at}`, entry(clock));
		expect(await cache.get("/p7")).toBeUndefined();
		expect(await cache.get("/p8")).toBeDefined();
		expect(await cache.get("/p39")).toBeDefined();
	});

	test("works from memory when the state dir cannot be written, and takes any cwd as a key", async () => {
		const blocker = join(temp(), "file");
		writeFileSync(blocker, "x");
		const clock = { time: 0 };
		const cache = cacheAt(join(blocker, "catalog.json"), clock);
		await cache.set("__proto__", entry(clock));
		expect(await cache.get("__proto__")).toBeDefined();
		expect(await cache.get("constructor")).toBeUndefined();
	});
});
