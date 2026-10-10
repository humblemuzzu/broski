import { describe, expect, test } from "bun:test";
import { bindWithRetry, isAddressInUse, isReportableAttempt } from "../lifecycle/port-retry";

function addressInUse(): Error & { code: string } {
	const error = new Error("listen EADDRINUSE: address already in use :::18274") as Error & { code: string };
	error.code = "EADDRINUSE";
	return error;
}

function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
	const delays: number[] = [];
	return {
		delays,
		sleep: async (ms: number) => {
			delays.push(ms);
		},
	};
}

describe("isAddressInUse", () => {
	test("detects EADDRINUSE on plain objects", () => {
		expect(isAddressInUse({ code: "EADDRINUSE" })).toBe(true);
		expect(isAddressInUse(addressInUse())).toBe(true);
	});

	test("ignores other errors and non-objects", () => {
		expect(isAddressInUse({ code: "EACCES" })).toBe(false);
		expect(isAddressInUse(new Error("nope"))).toBe(false);
		expect(isAddressInUse(null)).toBe(false);
		expect(isAddressInUse("EADDRINUSE")).toBe(false);
	});
});

describe("bindWithRetry", () => {
	test("daemon mode retries with exponential backoff and returns the bound value", async () => {
		const { sleep, delays } = recordingSleep();
		const attempts: number[] = [];

		const result = await bindWithRetry(
			async () => {
				attempts.push(attempts.length + 1);
				if (attempts.length < 4) throw addressInUse();
				return "bound";
			},
			{ mode: "daemon", sleep, initialDelayMs: 1000, maxDelayMs: 30_000 },
		);

		expect(result).toBe("bound");
		expect(attempts.length).toBe(4);
		expect(delays).toEqual([1000, 2000, 4000]);
	});

	test("caps the delay at maxDelayMs", async () => {
		const { sleep, delays } = recordingSleep();
		let attempts = 0;

		await bindWithRetry(
			async () => {
				attempts++;
				if (attempts < 8) throw addressInUse();
				return "bound";
			},
			{ mode: "daemon", sleep, initialDelayMs: 1000, maxDelayMs: 4000 },
		);

		expect(delays).toEqual([1000, 2000, 4000, 4000, 4000, 4000, 4000]);
	});

	test("once mode throws without retrying", async () => {
		const { sleep, delays } = recordingSleep();
		let attempts = 0;

		await expect(
			bindWithRetry(
				async () => {
					attempts++;
					throw addressInUse();
				},
				{ mode: "once", sleep },
			),
		).rejects.toThrow("EADDRINUSE");

		expect(attempts).toBe(1);
		expect(delays).toEqual([]);
	});

	test("non-retryable errors surface immediately in daemon mode", async () => {
		const { sleep, delays } = recordingSleep();
		let attempts = 0;

		await expect(
			bindWithRetry(
				async () => {
					attempts++;
					throw new Error("permission denied");
				},
				{ mode: "daemon", sleep },
			),
		).rejects.toThrow("permission denied");

		expect(attempts).toBe(1);
		expect(delays).toEqual([]);
	});

	test("reports the first attempts and then only every reportEvery attempts", async () => {
		const { sleep } = recordingSleep();
		const reported: number[] = [];
		let attempts = 0;

		await bindWithRetry(
			async () => {
				attempts++;
				if (attempts < 26) throw addressInUse();
				return "bound";
			},
			{
				mode: "daemon",
				sleep,
				initialDelayMs: 1,
				reportEvery: 20,
				onRetry: (info) => reported.push(info.attempt),
			},
		);

		expect(reported).toEqual([1, 2, 3, 4, 5, 20]);
		expect(isReportableAttempt(6, { reportEvery: 20 })).toBe(false);
		expect(isReportableAttempt(40, { reportEvery: 20 })).toBe(true);
	});

	test("past the budget the delay stays at maxDelayMs instead of growing", async () => {
		const delays: number[] = [];
		let clock = 0;
		let attempts = 0;

		await bindWithRetry(
			async () => {
				attempts++;
				if (attempts < 4) throw addressInUse();
				return "bound";
			},
			{
				mode: "daemon",
				sleep: async (ms: number) => {
					clock += ms;
					delays.push(ms);
				},
				initialDelayMs: 1000,
				maxDelayMs: 30_000,
				budgetMs: 2_000,
				now: () => clock,
			},
		);

		expect(delays).toEqual([1000, 2000, 30_000]);
	});

	test("recovers when the port frees after real EADDRINUSE failures", async () => {
		const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("held") });
		const port = holder.port;
		let released = false;
		let retries = 0;

		try {
			const server = await bindWithRetry(
				async () => {
					try {
						return Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("ok") });
					} catch (error) {
						if (!isAddressInUse(error)) throw error;
						throw error;
					}
				},
				{
					mode: "daemon",
					initialDelayMs: 1,
					maxDelayMs: 5,
					onRetry: () => {
						retries++;
						if (!released) {
							released = true;
							holder.stop(true);
						}
					},
					sleep: (ms) => Bun.sleep(ms),
				},
			);

			expect(retries).toBeGreaterThanOrEqual(1);
			expect(server.port).toBe(port);
			server.stop(true);
		} finally {
			if (!released) holder.stop(true);
		}
	});
});
