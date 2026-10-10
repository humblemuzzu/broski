import { describe, expect, it } from "bun:test";
import { singleFlight } from "../utils/single-flight";

describe("singleFlight", () => {
	it("shares one run between concurrent callers on the same key", async () => {
		const inFlight = new Map<string, Promise<number>>();
		let runs = 0;
		const run = async () => {
			runs++;
			return 42;
		};
		const [first, second] = await Promise.all([singleFlight(inFlight, "k", run), singleFlight(inFlight, "k", run)]);
		expect(first).toBe(42);
		expect(second).toBe(42);
		expect(runs).toBe(1);
	});

	it("clears the key once settled so the next call runs again", async () => {
		const inFlight = new Map<string, Promise<number>>();
		let runs = 0;
		const run = async () => {
			runs++;
			return runs;
		};
		expect(await singleFlight(inFlight, "k", run)).toBe(1);
		expect(await singleFlight(inFlight, "k", run)).toBe(2);
		expect(inFlight.size).toBe(0);
	});

	it("keeps separate keys independent", async () => {
		const inFlight = new Map<string, Promise<string>>();
		let runs = 0;
		const run = async () => {
			runs++;
			return "x";
		};
		await Promise.all([singleFlight(inFlight, "a", run), singleFlight(inFlight, "b", run)]);
		expect(runs).toBe(2);
		expect(inFlight.size).toBe(0);
	});

	it("rejects every joiner and clears the key", async () => {
		const inFlight = new Map<string, Promise<number>>();
		let runs = 0;
		const run = async () => {
			runs++;
			throw new Error("boom");
		};
		const first = singleFlight(inFlight, "k", run);
		const second = singleFlight(inFlight, "k", run);
		await expect(first).rejects.toThrow("boom");
		await expect(second).rejects.toThrow("boom");
		expect(runs).toBe(1);
		expect(inFlight.size).toBe(0);
	});

	it("dedupes a synchronously thrown run into one rejection", async () => {
		const inFlight = new Map<string, Promise<void>>();
		let runs = 0;
		const run = () => {
			runs++;
			throw new Error("sync");
		};
		const first = singleFlight(inFlight, "k", run);
		const second = singleFlight(inFlight, "k", run);
		await expect(first).rejects.toThrow("sync");
		await expect(second).rejects.toThrow("sync");
		expect(runs).toBe(1);
	});
});
