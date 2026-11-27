/** Finding the user's `pi`, asking it its version, and what the doctor says of both. */

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCliVersion } from "../../adapter-kit/cli-version";
import { MIN_PI_VERSION, PI_INSTALL_COMMAND, PI_INSTALL_FIX, PI_UPDATE_FIX } from "../../backends/pi/pi-install";
import { piCliCheck } from "../../doctor/checks/pi-cli";
import { resolvePiCli } from "../../server/pi-cli-path";

const dirs: string[] = [];

function executable(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "broski-pi-cli-"));
	dirs.push(dir);
	const path = join(dir, "pi");
	writeFileSync(path, `#!/bin/sh\n${body}\n`);
	chmodSync(path, 0o755);
	return path;
}

afterEach(() => {
	dirs.length = 0;
});

describe("pi executable resolution", () => {
	test("pi.cliPath wins when it is a file", () => {
		const configured = executable("exit 0");
		expect(resolvePiCli(configured, () => "/usr/local/bin/pi")).toEqual({ found: true, path: configured });
	});

	test("a pi.cliPath that is not a file is passed over for pi on PATH, and named when nothing else is found", () => {
		expect(resolvePiCli("/missing/pi", () => "/usr/local/bin/pi")).toEqual({ found: true, path: "/usr/local/bin/pi" });

		const asked: string[] = [];
		const missing = resolvePiCli("  /missing/pi ", (name) => {
			asked.push(name);
			return null;
		});
		expect(asked).toEqual(["pi"]);
		expect(missing.found).toBe(false);
		expect(!missing.found && missing.reason).toStartWith("pi.cliPath /missing/pi is not a file. ");
		expect(!missing.found && missing.reason).toContain(PI_INSTALL_FIX);
	});

	test("without a configured path it is pi on PATH, and the fix names both ways to point the bridge at one", () => {
		expect(resolvePiCli(undefined, () => "/opt/pi")).toEqual({ found: true, path: "/opt/pi" });
		expect(resolvePiCli("   ", () => "/opt/pi")).toEqual({ found: true, path: "/opt/pi" });
		const missing = resolvePiCli(undefined, () => null);
		expect(!missing.found && missing.reason).toContain(PI_INSTALL_COMMAND);
		expect(!missing.found && missing.reason).toContain('"pi": {"cliPath": "/path/to/pi"}');
	});
});

describe("pi --version", () => {
	test("is the version the executable prints, run with the environment it is given", async () => {
		const pi = executable('echo "pi $BROSKI_TEST_MARK 1.5.2"');
		expect(await readCliVersion(pi, { BROSKI_TEST_MARK: "x" })).toEqual({ version: "1.5.2" });
	});

	test("is a problem naming the executable when it prints none, or cannot run", async () => {
		const silent = executable("echo not a version; exit 3");
		expect(await readCliVersion(silent)).toEqual({ problem: expect.stringContaining(`${silent} --version`) });
		expect(await readCliVersion(join(tmpdir(), "no-such-pi"))).toEqual({
			problem: expect.stringContaining("did not print a version"),
		});
	});
});

describe("the doctor's check of pi", () => {
	const found = { found: true, path: "/opt/pi" } as const;

	test("not found: a warning with the reason and the fix", async () => {
		expect(await piCliCheck({ found: false, reason: "no pi here" })).toMatchObject({
			status: "warning",
			message: "Pi not found",
			details: ["no pi here"],
			fix: PI_INSTALL_FIX,
		});
	});

	test("one that does not run, one below the oldest this bridge runs as intended, and a good one", async () => {
		expect(await piCliCheck(found, async () => ({ problem: "exploded" }))).toMatchObject({
			status: "warning",
			details: ["exploded"],
			fix: PI_INSTALL_FIX,
		});
		expect(await piCliCheck(found, async () => ({ version: "1.4.9" }))).toMatchObject({
			status: "warning",
			message: `Pi 1.4.9 is older than ${MIN_PI_VERSION} (/opt/pi)`,
			fix: PI_UPDATE_FIX,
		});
		expect(await piCliCheck(found, async () => ({ version: MIN_PI_VERSION }))).toMatchObject({
			status: "ok",
			message: `Pi ${MIN_PI_VERSION} (/opt/pi)`,
		});
	});
});
