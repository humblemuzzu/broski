import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const FIXTURES = resolve(__dirname, "fixtures");

async function runProbe(
	script: string,
	env: Record<string, string> = {},
): Promise<{ output: string; exitCode: number }> {
	const home = mkdtempSync(join(tmpdir(), "broski-module-probe-"));
	const proc = Bun.spawn({
		cmd: ["bun", script],
		cwd: resolve(__dirname, "..", ".."),
		env: { ...process.env, HOME: home, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	rmSync(home, { recursive: true, force: true });
	return { output: `${stdout}\n${stderr}`, exitCode };
}

describe("lazy agent SDK imports", () => {
	test("the CLI-only path of index.ts evaluates no agent SDK", async () => {
		const { output, exitCode } = await runProbe(resolve(FIXTURES, "cli-import-probe.ts"));
		expect(output).toContain("PROBE_SDK_MODULES=0");
		expect(exitCode).toBe(0);
	});

	test("an index.ts subcommand path evaluates no agent SDK", async () => {
		const { output } = await runProbe(resolve(FIXTURES, "cli-import-probe.ts"), { PROBE_ARGV: "version" });
		expect(output).toContain("PROBE_SDK_MODULES=0");
	});

	const MODULES_THE_SERVER_GRAPH_REACHES = ["src/server.ts", "src/custom-tools.ts"];

	for (const module of MODULES_THE_SERVER_GRAPH_REACHES) {
		test(`${module} loads without an agent SDK`, async () => {
			const { output } = await runProbe(resolve(FIXTURES, "connector-import-probe.ts"), { PROBE_MODULE: module });
			expect(output).toContain("PROBE_SDK_MODULES=0");
		});
	}

	test("the probe detects an SDK that is actually loaded", async () => {
		const { output } = await runProbe(resolve(FIXTURES, "connector-import-probe.ts"), {
			PROBE_MODULE: "src/__tests__/fixtures/sdk-bundle-probe.ts",
		});
		expect(output).not.toContain("PROBE_SDK_MODULES=0");
	});
});
