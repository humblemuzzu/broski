import { describe, expect, test } from "bun:test";
import { stopBridgeResources } from "../lifecycle/bridge-teardown";
import { createShutdownController } from "../lifecycle/shutdown-guard";
import { runTeardown } from "../lifecycle/teardown";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runTeardown", () => {
	test("awaits async cleanups and reports them as completed", async () => {
		const ran: string[] = [];
		const result = await runTeardown([
			{
				name: "slow",
				run: async () => {
					await sleep(20);
					ran.push("slow");
				},
			},
			{ name: "sync", run: () => ran.push("sync") },
		]);

		expect(ran).toContain("slow");
		expect(result.completed.sort()).toEqual(["slow", "sync"]);
		expect(result.pending).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(result.timedOut).toBe(false);
	});

	test("gives up after the budget while stragglers keep running", async () => {
		let fastFinished = false;
		let hangReleased = false;

		const result = await runTeardown(
			[
				{
					name: "hangs",
					run: () =>
						new Promise<void>((resolve) => {
							setTimeout(() => {
								hangReleased = true;
								resolve();
							}, 1500);
						}),
				},
				{
					name: "fast",
					run: async () => {
						await sleep(5);
						fastFinished = true;
					},
				},
			],
			{ timeoutMs: 40 },
		);

		expect(hangReleased).toBe(false);
		expect(result.timedOut).toBe(true);
		expect(result.pending).toEqual(["hangs"]);
		expect(result.completed).toEqual(["fast"]);
		expect(fastFinished).toBe(true);

		await sleep(1600);
		expect(hangReleased).toBe(true);
	});

	test("isolates failures and reports them to the caller", async () => {
		const errors: string[] = [];
		const result = await runTeardown(
			[
				{
					name: "boom",
					run: () => {
						throw new Error("cleanup exploded");
					},
				},
				{ name: "fine", run: async () => sleep(5) },
			],
			{ timeoutMs: 200, onError: (name) => errors.push(name) },
		);

		expect(result.failed.map((failure) => failure.name)).toEqual(["boom"]);
		expect(result.completed).toEqual(["fine"]);
		expect(result.pending).toEqual([]);
		expect(errors).toEqual(["boom"]);
	});

	test("reports timed out task names to the caller", async () => {
		const pendingSeen: string[][] = [];
		await runTeardown([{ name: "stuck", run: () => new Promise<void>(() => {}) }], {
			timeoutMs: 20,
			onTimeout: (pending) => pendingSeen.push(pending),
		});
		expect(pendingSeen).toEqual([["stuck"]]);
	});
});

describe("stopBridgeResources", () => {
	test("stops the servers first, then awaits the backends' disposal", async () => {
		const calls: string[] = [];
		const result = await stopBridgeResources(
			{
				stopServers: () => calls.push("servers"),
				disposeBackends: async () => {
					await sleep(20);
					calls.push("backends");
				},
			},
			{ timeoutMs: 500, log: () => {} },
		);

		expect(calls).toEqual(["servers", "backends"]);
		expect(result).toMatchObject({ timedOut: false, completed: ["backends"], pending: [], failed: [] });
	});

	test("a disposal that hangs is given up on at the budget and logged", async () => {
		const logs: string[] = [];
		const result = await stopBridgeResources(
			{ stopServers: () => {}, disposeBackends: () => new Promise<void>(() => {}) },
			{ timeoutMs: 40, log: (message) => logs.push(message) },
		);

		expect(result.timedOut).toBe(true);
		expect(result.pending).toEqual(["backends"]);
		expect(logs.some((line) => line.includes("backends"))).toBe(true);
	});

	test("a server that refuses to stop and a disposal that throws are logged, never thrown", async () => {
		const logs: string[] = [];
		const result = await stopBridgeResources(
			{
				stopServers: () => {
					throw new Error("already down");
				},
				disposeBackends: () => {
					throw new Error("backend refused to stop");
				},
			},
			{ timeoutMs: 200, log: (message) => logs.push(message) },
		);

		expect(result.failed.map((failure) => failure.name)).toEqual(["backends"]);
		expect(logs.some((line) => line.includes("backend refused to stop"))).toBe(true);
	});
});

describe("createShutdownController", () => {
	test("runs the shutdown once even when signals arrive together", async () => {
		let runs = 0;
		const exits: number[] = [];
		const controller = createShutdownController({
			run: async () => {
				runs++;
				await sleep(15);
			},
			exit: (code) => exits.push(code),
			log: () => {},
		});

		await Promise.all([controller.request("SIGINT"), controller.request("SIGTERM"), controller.request("SIGINT", 1)]);

		expect(runs).toBe(1);
		expect(exits).toEqual([0]);
	});

	test("logs a fatal error once with its stack and exits 1", async () => {
		const logs: string[] = [];
		const exits: number[] = [];
		const controller = createShutdownController({
			run: async () => sleep(5),
			exit: (code) => exits.push(code),
			log: (message) => logs.push(message),
		});

		await Promise.all([
			controller.fatal("Uncaught exception", new Error("kaboom")),
			controller.fatal("Uncaught exception", new Error("kaboom again")),
		]);

		expect(exits).toEqual([1]);
		expect(logs.length).toBe(1);
		expect(logs[0]).toContain("kaboom");
		expect(logs[0]).toContain("Error");
	});

	test("still exits when the shutdown itself throws", async () => {
		const logs: string[] = [];
		const exits: number[] = [];
		const controller = createShutdownController({
			run: async () => {
				throw new Error("teardown blew up");
			},
			exit: (code) => exits.push(code),
			log: (message) => logs.push(message),
		});

		await controller.request("SIGTERM");

		expect(exits).toEqual([0]);
		expect(logs.some((line) => line.includes("teardown blew up"))).toBe(true);
	});
});
