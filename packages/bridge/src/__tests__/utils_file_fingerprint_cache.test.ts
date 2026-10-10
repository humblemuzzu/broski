import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FileFingerprint, FileFingerprintCache } from "../utils/file-fingerprint-cache";

let tmpDirs: string[] = [];
const caches: Array<{ dispose: () => void }> = [];

function makeCache<T>(cache: FileFingerprintCache<T>): FileFingerprintCache<T> {
	caches.push(cache);
	return cache;
}

async function tmpFile(content: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-fingerprint-"));
	tmpDirs.push(dir);
	const path = join(dir, "value.txt");
	await writeFile(path, content);
	return path;
}

const fp = (mtimeMs: number, size = 0, ino = 1, ctimeMs = mtimeMs): FileFingerprint => ({
	mtimeMs,
	size,
	ino,
	ctimeMs,
});

afterEach(async () => {
	for (const cache of caches) cache.dispose();
	caches.length = 0;
	await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	tmpDirs = [];
});

describe("FileFingerprintCache", () => {
	it("computes once and serves a warm get from cache", async () => {
		const path = await tmpFile("hello");
		let calls = 0;
		const cache = makeCache(
			new FileFingerprintCache<string>({ byteBudget: 1024, estimateBytes: (value) => value.length }),
		);
		const compute = async () => {
			calls++;
			return "value";
		};
		expect(await cache.get(path, compute)).toBe("value");
		expect(await cache.get(path, compute)).toBe("value");
		expect(calls).toBe(1);
		expect(cache.stats()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
	});

	it("recomputes when the fingerprint changes", async () => {
		const path = await tmpFile("hello");
		let calls = 0;
		const cache = makeCache(
			new FileFingerprintCache<string>({ byteBudget: 1024, estimateBytes: (value) => value.length }),
		);
		const compute = async () => {
			calls++;
			return `value-${calls}`;
		};
		expect(await cache.get(path, compute)).toBe("value-1");
		await writeFile(path, "hello, changed size");
		expect(await cache.get(path, compute)).toBe("value-2");
	});

	it("shares one compute between concurrent gets", async () => {
		const path = await tmpFile("hello");
		let calls = 0;
		const gate = Promise.withResolvers<void>();
		const cache = makeCache(
			new FileFingerprintCache<string>({ byteBudget: 1024, estimateBytes: (value) => value.length }),
		);
		const compute = async () => {
			calls++;
			await gate.promise;
			return "value";
		};
		const first = cache.get(path, compute);
		const second = cache.get(path, compute);
		gate.resolve();
		await Promise.all([first, second]);
		expect(calls).toBe(1);
		expect(cache.stats()).toMatchObject({ entries: 1, misses: 1 });
	});

	it("evicts the least-recently-used entry over the byte budget", async () => {
		const fingerprints = new Map<string, FileFingerprint>();
		for (const path of ["/a", "/b", "/c"]) fingerprints.set(path, fp(1));
		const cache = makeCache(
			new FileFingerprintCache<number>({
				byteBudget: 20,
				estimateBytes: () => 10,
				fingerprint: async (path) => fingerprints.get(path) ?? null,
			}),
		);
		await cache.get("/a", async () => 1);
		await cache.get("/b", async () => 2);
		await cache.get("/c", async () => 3);
		expect(cache.has("/a")).toBe(false);
		expect(cache.has("/b")).toBe(true);
		expect(cache.has("/c")).toBe(true);
		expect(cache.stats()).toMatchObject({ entries: 2, bytes: 20 });
	});

	it("keeps a recently read entry when evicting", async () => {
		const fingerprints = new Map<string, FileFingerprint>();
		for (const path of ["/a", "/b", "/c"]) fingerprints.set(path, fp(1));
		const cache = makeCache(
			new FileFingerprintCache<number>({
				byteBudget: 20,
				estimateBytes: () => 10,
				fingerprint: async (path) => fingerprints.get(path) ?? null,
			}),
		);
		await cache.get("/a", async () => 1);
		await cache.get("/b", async () => 2);
		await cache.get("/a", async () => 1);
		await cache.get("/c", async () => 3);
		expect(cache.has("/a")).toBe(true);
		expect(cache.has("/b")).toBe(false);
		expect(cache.has("/c")).toBe(true);
	});

	it("does not cache when the path has no fingerprint", async () => {
		let calls = 0;
		const cache = makeCache(
			new FileFingerprintCache<string>({
				byteBudget: 1024,
				estimateBytes: (value) => value.length,
				fingerprint: async () => null,
			}),
		);
		const compute = async () => {
			calls++;
			return "value";
		};
		await cache.get("/gone", compute);
		await cache.get("/gone", compute);
		expect(calls).toBe(2);
		expect(cache.stats().entries).toBe(0);
	});

	it("sheds on critical memory pressure only when asked to", async () => {
		const shedding = makeCache(
			new FileFingerprintCache<string>({
				byteBudget: 1024,
				estimateBytes: (value) => value.length,
				shedOnPressure: true,
				fingerprint: async () => fp(1),
			}),
		);
		await shedding.get("/a", async () => "value");
		process.emit("memoryPressure", "warning");
		expect(shedding.has("/a")).toBe(true);
		process.emit("memoryPressure", "critical");
		expect(shedding.has("/a")).toBe(false);

		const quiet = makeCache(
			new FileFingerprintCache<string>({
				byteBudget: 1024,
				estimateBytes: (value) => value.length,
				fingerprint: async () => fp(1),
			}),
		);
		await quiet.get("/a", async () => "value");
		process.emit("memoryPressure", "critical");
		expect(quiet.has("/a")).toBe(true);
	});

	it("stops listening after dispose", async () => {
		const cache = new FileFingerprintCache<string>({
			byteBudget: 1024,
			estimateBytes: (value) => value.length,
			shedOnPressure: true,
			fingerprint: async () => fp(1),
		});
		cache.dispose();
		await cache.get("/a", async () => "value");
		process.emit("memoryPressure", "critical");
		expect(cache.has("/a")).toBe(true);
	});

	it("deletes and clears entries with byte accounting", async () => {
		const fingerprints = new Map<string, FileFingerprint>();
		const cache = makeCache(
			new FileFingerprintCache<number>({
				byteBudget: 1000,
				estimateBytes: () => 40,
				fingerprint: async (path) => fingerprints.get(path) ?? null,
			}),
		);
		for (const path of ["/a", "/b"]) fingerprints.set(path, fp(1));
		await cache.get("/a", async () => 1);
		await cache.get("/b", async () => 2);
		expect(cache.stats().bytes).toBe(80);
		expect(cache.delete("/a")).toBe(true);
		expect(cache.delete("/a")).toBe(false);
		expect(cache.stats()).toMatchObject({ entries: 1, bytes: 40 });
		cache.clear();
		expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
	});
});
