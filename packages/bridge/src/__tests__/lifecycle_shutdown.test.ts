import { describe, expect, test } from "bun:test";
import {
	type BridgeTeardownResources,
	releaseFailedBindResources,
	stopBridgeResources,
} from "../lifecycle/bridge-teardown";
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

function makeResources(overrides?: Partial<BridgeTeardownResources>): {
	resources: BridgeTeardownResources;
	calls: string[];
	tails: Map<string, { stop: () => void }>;
	buffers: Map<string, unknown>;
} {
	const calls: string[] = [];
	const tails = new Map<string, { stop: () => void }>([["session-1", { stop: () => calls.push("tail") }]]);
	const buffers = new Map<string, unknown>([["session-1", []]]);

	const resources: BridgeTeardownResources = {
		externalTails: [tails],
		eventBuffers: [buffers],
		closeFsWatchers: () => calls.push("fs-watchers"),
		stopPtyRuntime: async () => {
			await sleep(5);
			calls.push("pty");
		},
		uninstallHooks: [async () => calls.push("hook-cc"), async () => calls.push("hook-cx")],
		stopCodexAppServer: async () => calls.push("codex"),
		disposeBackends: [() => calls.push("pi")],
		stopServers: () => calls.push("servers"),
		...overrides,
	};

	return { resources, calls, tails, buffers };
}

describe("stopBridgeResources", () => {
	test("stops servers first and then every async cleanup", async () => {
		const { resources, calls, tails, buffers } = makeResources();

		const result = await stopBridgeResources(resources, { timeoutMs: 500, log: () => {} });

		expect(calls[0]).toBe("servers");
		expect(tails.size).toBe(0);
		expect(buffers.size).toBe(0);
		for (const expected of ["fs-watchers", "pty", "hook-cc", "hook-cx", "codex", "pi"]) {
			expect(calls).toContain(expected);
		}
		expect(result.pending).toEqual([]);
		expect(result.failed).toEqual([]);
	});

	test("survives a hanging PTY shutdown and still stops the rest", async () => {
		const { resources, calls } = makeResources({
			stopPtyRuntime: () => new Promise<void>(() => {}),
		});
		const logs: string[] = [];

		const result = await stopBridgeResources(resources, { timeoutMs: 40, log: (message) => logs.push(message) });

		expect(result.timedOut).toBe(true);
		expect(result.pending).toEqual(["pty-runtime"]);
		expect(calls).toContain("codex");
		expect(calls).toContain("pi");
		expect(logs.some((line) => line.includes("pty-runtime"))).toBe(true);
	});

	test("a throwing cleanup is logged and does not abort the rest", async () => {
		const { resources, calls } = makeResources({
			stopCodexAppServer: () => {
				throw new Error("codex refused to die");
			},
		});
		const logs: string[] = [];

		const result = await stopBridgeResources(resources, { timeoutMs: 200, log: (message) => logs.push(message) });

		expect(result.failed.map((failure) => failure.name)).toEqual(["codex-app-server"]);
		expect(calls).toContain("pty");
		expect(logs.some((line) => line.includes("codex refused to die"))).toBe(true);
	});

	test("clears every tail map it is given", async () => {
		const cc = new Map([["a", { stop: () => {} }]]);
		const cx = new Map([["b", { stop: () => {} }]]);
		const oc = new Map([["c", { stop: () => {} }]]);
		const { resources } = makeResources({ externalTails: [cc, cx, oc] });

		await stopBridgeResources(resources, { timeoutMs: 200, log: () => {} });

		expect([cc.size, cx.size, oc.size]).toEqual([0, 0, 0]);
	});

	test("awaits async backend disposal (pi-durable shutdown)", async () => {
		let disposed = false;
		const { resources } = makeResources({
			disposeBackends: [
				() => {},
				async () => {
					await sleep(20);
					disposed = true;
				},
			],
		});

		await stopBridgeResources(resources, { timeoutMs: 500, log: () => {} });

		expect(disposed).toBe(true);
	});
});

describe("releaseFailedBindResources", () => {
	test("stops the timers a failed bind already started", async () => {
		let ticks = 0;
		const interval = setInterval(() => ticks++, 5);

		releaseFailedBindResources({
			intervals: [interval, null],
		});

		await sleep(30);
		expect(ticks).toBe(0);
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
