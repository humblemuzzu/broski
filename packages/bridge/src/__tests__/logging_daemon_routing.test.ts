import { afterEach, describe, expect, test } from "bun:test";
import { createShutdownController } from "../lifecycle/shutdown-guard";
import { logDaemon, logDaemonError, setDaemonLogger } from "../logging/daemon-log";
import type { BridgeLogger } from "../logging/logger";

function recordingLogger(): { logger: BridgeLogger; lines: string[]; errors: string[] } {
	const lines: string[] = [];
	const errors: string[] = [];
	return {
		lines,
		errors,
		logger: {
			user: (message) => lines.push(message),
			info: (message) => lines.push(message),
			debug: (message) => lines.push(message),
			error: (message) => errors.push(message),
			flush: async () => {},
		},
	};
}

afterEach(() => setDaemonLogger(null));

describe("daemon log routing", () => {
	test("a fatal on the shutdown path reaches the bridge logger", async () => {
		const { logger, errors } = recordingLogger();
		setDaemonLogger(logger);
		const exits: number[] = [];
		const controller = createShutdownController({ run: async () => {}, exit: (code) => exits.push(code) });

		await controller.fatal("Uncaught exception", new Error("kaboom"));

		expect(exits).toEqual([1]);
		expect(errors.some((line) => line.includes("kaboom"))).toBe(true);
	});

	test("lifecycle and error lines reach the logger's file", () => {
		const { logger, lines, errors } = recordingLogger();
		setDaemonLogger(logger);

		logDaemon("SIGTERM received. Shutting down...");
		logDaemonError("teardown failed");

		expect(lines).toContain("SIGTERM received. Shutting down...");
		expect(errors).toContain("teardown failed");
	});

	test("falls back to the console when no logger exists", () => {
		setDaemonLogger(null);
		const printed: string[] = [];
		const originalLog = console.log;
		const originalError = console.error;
		console.log = (...args: unknown[]) => {
			printed.push(args.join(" "));
		};
		console.error = (...args: unknown[]) => {
			printed.push(args.join(" "));
		};

		try {
			logDaemon("no-logger-line");
			logDaemonError("no-logger-error");
		} finally {
			console.log = originalLog;
			console.error = originalError;
		}

		expect(printed).toEqual(["no-logger-line", "no-logger-error"]);
	});
});
