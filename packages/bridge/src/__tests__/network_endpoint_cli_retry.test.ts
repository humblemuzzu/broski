import { describe, expect, test } from "bun:test";
import { type EndpointSnapshot, EndpointWatcher } from "../network/endpoint-watcher";

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

const noTailscale: EndpointSnapshot = { localIP: "10.0.0.2", tailscaleIP: null, hotspotIP: null };

describe("EndpointWatcher CLI fallback", () => {
	test("retries a null CLI result after a backoff instead of treating it as done", async () => {
		let now = 1_000_000;
		let calls = 0;
		const watcher = new EndpointWatcher({
			readEndpoints: () => noTailscale,
			interfacesFingerprint: () => "fp-1",
			resolveTailscaleViaCli: async () => {
				calls++;
				return null;
			},
			onChange: () => {},
			now: () => now,
		});

		watcher.tick();
		await Bun.sleep(1);
		expect(calls).toBe(1);

		now += 5_000;
		watcher.tick();
		await Bun.sleep(1);
		expect(calls).toBe(1);

		now += 10_000;
		watcher.tick();
		await Bun.sleep(1);
		expect(calls).toBe(2);
	});

	test("backs off so a missing CLI is not spawned on every tick", async () => {
		let now = 0;
		let calls = 0;
		const watcher = new EndpointWatcher({
			readEndpoints: () => noTailscale,
			interfacesFingerprint: () => "fp-1",
			resolveTailscaleViaCli: async () => {
				calls++;
				return null;
			},
			onChange: () => {},
			now: () => now,
		});

		for (let i = 0; i < 30; i++) {
			watcher.tick();
			await Bun.sleep(0);
			now += 10_000;
		}

		expect(calls).toBeGreaterThanOrEqual(2);
		expect(calls).toBeLessThan(30);
	});

	test("a successful resolution stops the CLI until the interfaces change", async () => {
		const timers = fakeTimers();
		let fingerprint = "fp-1";
		let calls = 0;
		const watcher = new EndpointWatcher({
			readEndpoints: () => noTailscale,
			interfacesFingerprint: () => fingerprint,
			resolveTailscaleViaCli: async () => {
				calls++;
				return "100.64.0.9";
			},
			onChange: () => {},
			interval: { start: timers.start },
		});

		watcher.start();
		await Bun.sleep(1);
		expect(calls).toBe(1);
		expect(watcher.snapshot().tailscaleIP).toBe("100.64.0.9");

		for (let i = 0; i < 20; i++) timers.tick();
		await Bun.sleep(1);
		expect(calls).toBe(1);

		fingerprint = "fp-2";
		timers.tick();
		await Bun.sleep(1);
		expect(calls).toBe(2);
	});

	test("an interface change retries a CLI that was backing off", async () => {
		let now = 0;
		let fingerprint = "fp-1";
		let calls = 0;
		const watcher = new EndpointWatcher({
			readEndpoints: () => noTailscale,
			interfacesFingerprint: () => fingerprint,
			resolveTailscaleViaCli: async () => {
				calls++;
				return null;
			},
			onChange: () => {},
			now: () => now,
		});

		watcher.tick();
		await Bun.sleep(0);
		expect(calls).toBe(1);

		now += 1_000;
		fingerprint = "fp-2";
		watcher.tick();
		await Bun.sleep(0);
		expect(calls).toBe(2);
	});
});
