/**
 * The bounded collections a daemon keeps for weeks: entries must be dropped past the cap and the
 * TTL, an entry that is still in use must survive, and the map must behave like a `Map`.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import {
	type BoundedEvictReason,
	BoundedMap,
	boundedStateSizes,
	registerSweepable,
	sweepBoundedState,
} from "../state/bounded-map";
import {
	getCachedProject,
	invalidateCache,
	resetCacheStats,
	setCachedProject,
} from "../workspace/files/file-search-cache";

type Eviction = { key: string; value: number; reason: BoundedEvictReason };

function makeMap(maxEntries: number, ttlMs?: number) {
	let clock = 1_000_000;
	const evictions: Eviction[] = [];
	const map = new BoundedMap<string, number>({
		maxEntries,
		ttlMs,
		onEvict: (key, value, reason) => evictions.push({ key, value, reason }),
		now: () => clock,
	});
	return { map, evictions, advance: (ms: number) => (clock += ms) };
}

describe("BoundedMap", () => {
	it("behaves like a Map", () => {
		const { map } = makeMap(4);
		map.set("a", 1);
		map.set("b", 2);
		expect(map.size).toBe(2);
		expect(map.has("b")).toBe(true);
		expect(map.get("a")).toBe(1);
		expect([...map.keys()]).toEqual(["b", "a"]);
		expect([...map.values()]).toEqual([2, 1]);
		expect([...map.entries()]).toEqual([
			["b", 2],
			["a", 1],
		]);
		expect(map.delete("a")).toBe(true);
		expect(map.delete("a")).toBe(false);

		map.set("c", 3);
		const spread = [...map];
		expect(spread).toEqual([
			["b", 2],
			["c", 3],
		]);
		map.clear();
		expect(map.size).toBe(0);
	});

	it("drops the least recently used entry past the cap and reports it", () => {
		const { map, evictions } = makeMap(3);
		map.set("a", 1);
		map.set("b", 2);
		map.set("c", 3);
		expect(map.get("a")).toBe(1);

		map.set("d", 4);

		expect(map.size).toBe(3);
		expect(map.has("b")).toBe(false);
		expect([...map.keys()]).toEqual(["c", "a", "d"]);
		expect(evictions).toEqual([{ key: "b", value: 2, reason: "capacity" }]);
	});

	it("keeps an entry that is read while others pass it by", () => {
		const { map } = makeMap(2);
		map.set("a", 1);
		map.set("b", 2);

		for (let index = 0; index < 10; index++) {
			expect(map.get("a")).toBe(1);
			map.set(`fresh-${index}`, index);
		}

		expect(map.has("a")).toBe(true);
		expect(map.has("b")).toBe(false);
	});

	it("expires an untouched entry on read or on sweep", () => {
		const { map, evictions, advance } = makeMap(10, 1000);
		map.set("a", 1);
		map.set("b", 2);

		advance(600);
		expect(map.get("a")).toBe(1);
		advance(600);

		expect(map.has("a")).toBe(true);
		expect(map.get("b")).toBeUndefined();
		expect(evictions).toEqual([{ key: "b", value: 2, reason: "ttl" }]);

		expect(map.get("a")).toBe(1);
		advance(600);
		expect(map.sweep()).toBe(0);
		expect(map.size).toBe(1);

		advance(1001);
		expect(map.sweep()).toBe(1);
		expect(map.size).toBe(0);
	});

	it("reports every entry it drops when it is cleared", () => {
		const { map, evictions } = makeMap(4);
		map.set("a", 1);
		map.set("b", 2);
		map.clear();
		expect(evictions.map((entry) => entry.reason)).toEqual(["clear", "clear"]);
		expect(evictions.map((entry) => entry.key)).toEqual(["a", "b"]);
	});
});

describe("bounded state registry", () => {
	it("sweeps and reports only what is registered", () => {
		const { map, advance } = makeMap(10, 1000);
		map.set("a", 1);
		advance(2000);
		const unregister = registerSweepable({
			name: "tests-bounded-map",
			sweep: (now) => map.sweep(now ?? undefined),
			size: () => map.size,
			limit: () => 10,
		});

		try {
			expect(boundedStateSizes().some((state) => state.name === "tests-bounded-map")).toBe(true);
			expect(sweepBoundedState()).toBeGreaterThanOrEqual(1);
			expect(map.size).toBe(0);
		} finally {
			unregister();
		}

		expect(boundedStateSizes().some((state) => state.name === "tests-bounded-map")).toBe(false);
	});
});

describe("file search project cache", () => {
	beforeEach(() => {
		invalidateCache();
		resetCacheStats();
	});

	it("keeps only the most recent projects", () => {
		for (let index = 0; index < 20; index++) setCachedProject(`/tmp/project-${index}`, [`file-${index}.ts`], []);

		expect(getCachedProject("/tmp/project-19")).not.toBeNull();
		expect(getCachedProject("/tmp/project-0")).toBeNull();
		const stats = boundedStateSizes().find((state) => state.name === "file-search-projects");
		expect(stats?.size).toBeLessThanOrEqual(stats?.limit ?? 0);
	});
});
