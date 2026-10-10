import { describe, expect, it } from "bun:test";
import { runPool } from "../utils/bounded-pool";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("runPool", () => {
	it("runs every item on success", async () => {
		const seen: number[] = [];
		await runPool([1, 2, 3, 4, 5], 2, async (item) => {
			seen.push(item);
		});
		expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
	});

	it("never exceeds the concurrency limit", async () => {
		let active = 0;
		let peak = 0;
		await runPool(
			Array.from({ length: 12 }, (_, index) => index),
			3,
			async () => {
				active++;
				peak = Math.max(peak, active);
				await sleep(5);
				active--;
			},
		);
		expect(peak).toBe(3);
	});

	it("handles empty and single-item input", async () => {
		await expect(runPool([], 4, async () => {})).resolves.toBeUndefined();
		let calls = 0;
		await runPool(["only"], 8, async () => {
			calls++;
		});
		expect(calls).toBe(1);
	});

	it("rethrows the first error", async () => {
		const original = new Error("boom");
		await expect(
			runPool([1, 2, 3], 1, async (item) => {
				if (item === 2) throw original;
			}),
		).rejects.toBe(original);
	});

	it("starts no new items after the first rejection", async () => {
		const started: number[] = [];
		await expect(
			runPool([1, 2, 3, 4, 5], 1, async (item) => {
				started.push(item);
				if (item === 2) throw new Error("stop");
			}),
		).rejects.toThrow("stop");
		expect(started).toEqual([1, 2]);
	});

	it("starts no new items after a rejection even with spare workers", async () => {
		const started: number[] = [];
		const gate = Promise.withResolvers<void>();
		const run = runPool([1, 2, 3, 4, 5, 6], 3, async (item) => {
			started.push(item);
			if (item === 1) throw new Error("early");
			await gate.promise;
		});
		await sleep(10);
		expect(started).toEqual([1, 2, 3]);
		gate.resolve();
		await expect(run).rejects.toThrow("early");
		expect(started).toEqual([1, 2, 3]);
	});
});
