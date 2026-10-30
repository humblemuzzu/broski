/** The child-process probe turns a loop that never yields, and one that eats memory, into results. */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runProbe } from "./helpers/probe";

describe("runProbe", () => {
	test("returns what a script printed", async () => {
		expect(await runProbe(["-e", 'console.log("fine")'])).toEqual({ status: "done", output: "fine\n" });
	});

	test("reports a script that fails", async () => {
		const result = await runProbe(["-e", 'throw new Error("nope")']);
		expect(result.status).toBe("failed");
		expect(result.status === "failed" && result.errors).toContain("nope");
	});

	test("kills a loop that never yields, at the clock", async () => {
		const began = performance.now();
		const result = await runProbe(["-e", "for (;;) {}"], { timeoutMs: 700, maxRssMb: 1_500 });
		expect(result.status).toBe("timed_out");
		expect(performance.now() - began).toBeLessThan(5_000);
	});

	test("kills a script that grows past the memory cap", async () => {
		// It stops growing a little past the cap and spins there, so only the probe ends it, and its peak is bounded
		// whenever the probe looks (a script growing without end reached gigabytes between two looks).
		const grow =
			"const keep = []; for (;;) if (process.memoryUsage().rss < 800 * 1024 ** 2) keep.push(new Array(200_000).fill(1));";
		const result = await runProbe(["-e", grow], { timeoutMs: 20_000, maxRssMb: 600 });
		expect(result.status).toBe("too_big");
	}, 30_000);
});

describe("the watchdog thread", () => {
	const script = (name: string) => join(import.meta.dir, "helpers", name);

	test("kills a process whose event loop a chain of promises starves", async () => {
		const result = await runProbe([script("probe-stall.ts")], { timeoutMs: 20_000, maxRssMb: 3_000 });
		expect(result.status).toBe("failed");
		expect(result.status === "failed" && result.errors).toContain("has not turned its event loop");
	}, 30_000);

	test("kills a process that grows through promises past its memory limit", async () => {
		const result = await runProbe([script("probe-grow.ts")], { timeoutMs: 30_000, maxRssMb: 3_000 });
		expect(result.status).toBe("failed");
		expect(result.status === "failed" && result.errors).toMatch(/holds \d+ MB, past 500 MB/);
	}, 40_000);
});
