import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(relative: string): string {
	return readFileSync(resolve(__dirname, "..", relative), "utf-8");
}

describe("serve daemon logging wiring", () => {
	test("the bridge logger is installed for the lifecycle paths", () => {
		const serve = source("serve.ts");
		expect(serve).toContain("setDaemonLogger(bridgeLogger)");
		expect(serve).not.toContain("log: (message) => console.error(message)");
	});

	test("the shutdown sequence logs through the daemon logger", () => {
		const shutdown = source("serve/shutdown.ts");
		const body = shutdown.slice(
			shutdown.indexOf("async function runShutdown"),
			shutdown.indexOf("export async function restartManagedOpenCode"),
		);
		expect(body).toContain("logDaemon(");
		expect(body).toContain("received. Shutting down...");
		expect(body).not.toContain("console.");
	});

	test("the restart and bootstrap paths log through the logger", () => {
		const shutdown = source("serve/shutdown.ts");
		const restart = shutdown.slice(shutdown.indexOf("export async function restartManagedOpenCode"));
		expect(restart).toContain("logDaemon(");
		expect(restart).not.toContain("console.");

		const openCode = source("serve/open-code.ts");
		const bootstrap = openCode.slice(openCode.indexOf("async function bootstrapManagedOpenCode"));
		expect(bootstrap).toContain("logDaemon(");
		expect(bootstrap).not.toContain("console.");
	});

	test("the serve path logs through the logger", () => {
		const serve = source("serve.ts");
		const body = serve.slice(serve.indexOf('process.on("SIGINT"'));
		expect(body).toContain("logDaemon(");
		expect(body).not.toContain("console.");
	});
});
