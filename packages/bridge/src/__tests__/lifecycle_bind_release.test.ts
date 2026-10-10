import { describe, expect, test } from "bun:test";
import type { FSWatcher } from "node:fs";
import { CcFsWatcherRegistry } from "../handlers/cc_fs_watchers";
import { releaseFailedBindResources } from "../lifecycle/bridge-teardown";
import { boundedStateSizes, registerSweepable } from "../state/bounded-map";

type FakeTimers = { start: (fn: () => void, ms: number) => () => void; tick: () => void; stops: number };

function fakeTimers(): FakeTimers {
	let current: (() => void) | null = null;
	let stops = 0;
	return {
		start: (fn: () => void) => {
			current = fn;
			return () => {
				stops++;
				current = null;
			};
		},
		tick: () => current?.(),
		get stops() {
			return stops;
		},
	};
}

function fakeWatcher(): FSWatcher {
	return { on: () => {}, close: () => {} } as unknown as FSWatcher;
}

function makeRegistry(timers: FakeTimers): CcFsWatcherRegistry {
	return new CcFsWatcherRegistry({
		onChange: () => {},
		interval: { start: timers.start },
		watchDir: () => fakeWatcher(),
	});
}

describe("releaseFailedBindResources", () => {
	test("a failed bind releases the fs watchers and the bounded-state sweepables", async () => {
		const timers = fakeTimers();
		const registry = makeRegistry(timers);
		registry.ensure("/tmp/broski-release-check", "skills");
		expect(registry.size).toBe(1);

		const unregister = registerSweepable({
			name: "tests-failed-bind-release",
			sweep: () => 0,
			size: () => registry.size,
			limit: () => 32,
		});
		let ticks = 0;
		const interval = setInterval(() => {
			ticks++;
		}, 5);
		let watcherStopped = false;

		try {
			releaseFailedBindResources({
				intervals: [interval, null],
				stopEndpointWatcher: () => {
					watcherStopped = true;
				},
				closeFsWatchers: () => registry.closeAll(),
				unregisterSweepables: [unregister],
			});

			expect(watcherStopped).toBe(true);
			expect(registry.size).toBe(0);
			expect(timers.stops).toBeGreaterThanOrEqual(1);
			expect(boundedStateSizes().some((state) => state.name === "tests-failed-bind-release")).toBe(false);

			await Bun.sleep(30);
			expect(ticks).toBe(0);
		} finally {
			clearInterval(interval);
			unregister();
			registry.closeAll();
		}
	});

	test("five failed binds leave no watchers, intervals or sweepables behind", () => {
		const registries: CcFsWatcherRegistry[] = [];
		const intervals: Array<ReturnType<typeof setInterval>> = [];
		const unregisters: Array<() => void> = [];
		const names: string[] = [];

		for (let attempt = 0; attempt < 5; attempt++) {
			const registry = makeRegistry(fakeTimers());
			registry.ensure(`/tmp/broski-release-${attempt}`, "plugins");
			const interval = setInterval(() => {}, 60_000);
			const name = `tests-bind-attempt-${attempt}`;
			const unregister = registerSweepable({ name, sweep: () => 0, size: () => registry.size, limit: () => 32 });

			registries.push(registry);
			intervals.push(interval);
			unregisters.push(unregister);
			names.push(name);

			releaseFailedBindResources({
				intervals: [interval],
				closeFsWatchers: () => registry.closeAll(),
				unregisterSweepables: [unregister],
			});
		}

		try {
			expect(registries.map((registry) => registry.size)).toEqual([0, 0, 0, 0, 0]);
			const registered = boundedStateSizes().map((state) => state.name);
			expect(names.filter((name) => registered.includes(name))).toEqual([]);
		} finally {
			for (const interval of intervals) clearInterval(interval);
			for (const unregister of unregisters) unregister();
			for (const registry of registries) registry.closeAll();
		}
	});
});
