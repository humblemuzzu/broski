import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function indexSource(): string {
	return readFileSync(resolve(__dirname, "..", "index.ts"), "utf-8");
}

describe("index daemon logging wiring", () => {
	test("the bridge logger is installed for the lifecycle paths", () => {
		const index = indexSource();
		expect(index).toContain("setDaemonLogger(bridgeLogger)");
		expect(index).not.toContain("log: (message) => console.error(message)");
	});

	test("the shutdown sequence logs through the daemon logger", () => {
		const index = indexSource();
		const shutdown = index.slice(
			index.indexOf("async function runShutdown"),
			index.indexOf("async function restartManagedOpenCode"),
		);
		expect(shutdown).toContain("logDaemon(");
		expect(shutdown).toContain("received. Shutting down...");
		expect(shutdown).not.toContain("console.");
	});

	test("the restart and bootstrap paths log through the logger", () => {
		const index = indexSource();
		const restart = index.slice(
			index.indexOf("async function restartManagedOpenCode"),
			index.indexOf("async function main"),
		);
		expect(restart).toContain("logDaemon(");
		expect(restart).not.toContain("console.");
	});

	test("the serve path logs through the logger", () => {
		const index = indexSource();
		const serve = index.slice(index.indexOf('process.on("SIGINT"'));
		expect(serve).toContain("logDaemon(");
		expect(serve).not.toContain("console.");
	});
});
