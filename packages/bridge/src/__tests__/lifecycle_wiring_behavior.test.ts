/**
 * Behavioural replacements for the source-text lifecycle/logging wiring tests: the serve process
 * handlers, the daemon-logger routing, and the logs CLI's own signal handling.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as realOs from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShutdownController } from "../lifecycle/shutdown-guard";
import { logDaemon, logDaemonError, setDaemonLogger } from "../logging/daemon-log";
import type { BridgeLogger } from "../logging/logger";
import { installProcessHandlers, type ShutdownHooks, type SignalTarget } from "../serve/process-handlers";

function fakeTarget() {
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const target: SignalTarget = {
		on: (event, listener) => {
			handlers.set(event, listener);
		},
	};
	return { target, handlers };
}

function recordingShutdown() {
	const signals: string[] = [];
	const fatals: Array<{ label: string; error: unknown }> = [];
	const hooks: ShutdownHooks = {
		request: (signal) => signals.push(signal),
		fatal: (label, error) => fatals.push({ label, error }),
	};
	return { hooks, signals, fatals };
}

describe("installProcessHandlers", () => {
	test("registers the shutdown and fatal handlers on POSIX", () => {
		const { target, handlers } = fakeTarget();
		const { hooks, signals, fatals } = recordingShutdown();

		installProcessHandlers(hooks, target, false);

		expect([...handlers.keys()].sort()).toEqual([
			"SIGINT",
			"SIGTERM",
			"SIGTSTP",
			"uncaughtException",
			"unhandledRejection",
		]);
		handlers.get("SIGINT")?.();
		handlers.get("SIGTERM")?.();
		handlers.get("SIGTSTP")?.();
		expect(signals).toEqual(["SIGINT", "SIGTERM", "SIGTSTP"]);

		handlers.get("uncaughtException")?.(new Error("boom"));
		handlers.get("unhandledRejection")?.("reason");
		expect(fatals.map((entry) => entry.label)).toEqual(["Uncaught exception", "Unhandled promise rejection"]);
	});

	test("skips SIGTSTP on Windows", () => {
		const { target, handlers } = fakeTarget();
		installProcessHandlers(recordingShutdown().hooks, target, true);
		expect(handlers.has("SIGTSTP")).toBe(false);
		expect(handlers.has("SIGINT")).toBe(true);
	});
});

describe("daemon logger routing", () => {
	const lines: string[] = [];
	const logger: BridgeLogger = {
		user: (message) => lines.push(`user:${message}`),
		info: (message) => lines.push(`info:${message}`),
		debug: (message) => lines.push(`debug:${message}`),
		error: (message) => lines.push(`error:${message}`),
		flush: async () => {},
	};

	test("logDaemon and logDaemonError go through the installed logger", () => {
		lines.length = 0;
		setDaemonLogger(logger);
		try {
			logDaemon("shutting down");
			logDaemonError("died", new Error("x"));
			expect(lines).toEqual(["user:shutting down", "error:died"]);
		} finally {
			setDaemonLogger(null);
		}
	});

	test("a fatal from the shutdown controller is reported through the daemon logger", async () => {
		lines.length = 0;
		setDaemonLogger(logger);
		const exits: number[] = [];
		try {
			const controller = createShutdownController({
				run: async () => {},
				exit: (code) => exits.push(code),
			});
			await controller.fatal("Uncaught exception", new Error("kaboom"));
			expect(exits).toEqual([1]);
			expect(lines.some((line) => line.startsWith("error:") && line.includes("kaboom"))).toBe(true);
		} finally {
			setDaemonLogger(null);
		}
	});

	test("without a logger, logDaemon falls back to console", () => {
		const printed: string[] = [];
		const original = console.log;
		console.log = (...args: string[]) => {
			printed.push(args.join(" "));
		};
		try {
			setDaemonLogger(null);
			logDaemon("fallback line");
		} finally {
			console.log = original;
		}
		expect(printed).toContain("fallback line");
	});
});

describe("logs CLI follow mode", () => {
	// logs.ts snapshots ~/.broski/logs at import from os.homedir(), which is fixed at process
	// start. Mocking node:os points that snapshot at a temp dir instead of the real one.
	let home: string;

	beforeAll(() => {
		home = mkdtempSync(join(tmpdir(), "broski-logs-cli-"));
		mkdirSync(join(home, ".broski", "logs"), { recursive: true });
		writeFileSync(join(home, ".broski", "logs", "bridge.log"), "first line\nsecond line\n");
		writeFileSync(join(home, ".broski", "logs", "bridge.error.log"), "error line\n");
		mock.module("node:os", () => ({ ...realOs, homedir: () => home }));
	});

	afterAll(() => {
		rmSync(home, { recursive: true, force: true });
	});

	test("following logs installs its own SIGINT handler that ends the follow loop", async () => {
		const { runLogs } = await import("../logs");
		const sigintBefore = process.listeners("SIGINT");
		const sigtermBefore = process.listeners("SIGTERM");
		const printed: string[] = [];
		const originalWrite = process.stdout.write;
		process.stdout.write = ((chunk: unknown) => {
			printed.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		try {
			const finished = runLogs({ logsJson: true, logsFollow: true, logsLines: 5 });

			const deadline = Date.now() + 2000;
			while (process.listeners("SIGINT").length <= sigintBefore.length && Date.now() < deadline) {
				await Bun.sleep(10);
			}
			const added = process.listeners("SIGINT").filter((listener) => !sigintBefore.includes(listener));
			expect(added.length).toBeGreaterThan(0);

			added[0]?.("SIGINT");
			await finished;
			expect(printed.join("")).toContain("second line");
		} finally {
			process.stdout.write = originalWrite;
			for (const listener of process.listeners("SIGINT")) {
				if (!sigintBefore.includes(listener)) process.removeListener("SIGINT", listener);
			}
			for (const listener of process.listeners("SIGTERM")) {
				if (!sigtermBefore.includes(listener)) process.removeListener("SIGTERM", listener);
			}
		}
	});
});
