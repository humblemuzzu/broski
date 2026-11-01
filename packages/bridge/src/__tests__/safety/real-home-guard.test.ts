/**
 * The real-home guard is the only thing standing between an isolated `bun test` / bench process and
 * the developer's live `~/.claude`, `~/.pi`, `~/.broski`. The write sites are probed in
 * a spawned child whose home is a temp directory, so nothing here can reach the real files.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDefaultConfig } from "../../config/defaults";
import { writeConfig } from "../../config/read-write";
import {
	assertNotRealHome,
	BENCH_ISOLATION_ENV,
	isIsolationActive,
	REAL_HOME_ENV,
	RealHomeWriteError,
	realHomeDir,
	setRealHomeForTesting,
	TEST_ISOLATION_ENV,
} from "../../safety/real-home-guard";
import { GUARD_REPORT_PREFIX, type GuardProbeReport } from "./guard-probe-protocol";

const CHILD_SCRIPT = resolve(import.meta.dir, "real-home-guard-child.ts");
const BRIDGE_ROOT = resolve(import.meta.dir, "..", "..");

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function runChild(home: string, realHome: string): GuardProbeReport {
	const result = spawnSync("bun", [CHILD_SCRIPT], {
		cwd: BRIDGE_ROOT,
		encoding: "utf-8",
		env: {
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			TMPDIR: process.env.TMPDIR ?? "/tmp",
			HOME: home,
			[REAL_HOME_ENV]: realHome,
			[TEST_ISOLATION_ENV]: "1",
		},
	});
	const stdout = result.stdout ?? "";
	const markerIndex = stdout.lastIndexOf(GUARD_REPORT_PREFIX);
	if (markerIndex < 0) {
		throw new Error(`child produced no report (status ${result.status}): ${stdout}\n${result.stderr ?? ""}`);
	}
	const line = stdout.slice(markerIndex + GUARD_REPORT_PREFIX.length).split("\n")[0] ?? "";
	return JSON.parse(line) as GuardProbeReport;
}

describe("real-home guard", () => {
	test("the test process is isolated and knows the real home", () => {
		expect(isIsolationActive()).toBe(true);
		expect(realHomeDir()).toBe(resolve(process.env[REAL_HOME_ENV] ?? ""));
	});

	test("flags a path inside the injected real home and leaves temp paths alone", () => {
		const fakeRealHome = tempDir("broski-guard-fake-home-");
		setRealHomeForTesting(fakeRealHome);
		try {
			expect(realHomeDir()).toBe(resolve(fakeRealHome));
			expect(() => assertNotRealHome(join(fakeRealHome, ".claude", "settings.json"), "probe")).toThrow(
				RealHomeWriteError,
			);
			expect(() => assertNotRealHome(fakeRealHome, "probe")).toThrow(RealHomeWriteError);
			expect(() => assertNotRealHome(join(tmpdir(), "broski-guard-elsewhere"), "probe")).not.toThrow();
		} finally {
			setRealHomeForTesting(null);
		}
	});

	test("a hook-installer write site refuses the injected real home and leaves it untouched", async () => {
		const fakeRealHome = tempDir("broski-guard-refuse-");
		setRealHomeForTesting(fakeRealHome);
		try {
			const target = join(fakeRealHome, ".broski", "config.json");
			await expect(writeConfig(getDefaultConfig(), target)).rejects.toThrow(RealHomeWriteError);
			expect(existsSync(join(fakeRealHome, ".broski"))).toBe(false);
		} finally {
			setRealHomeForTesting(null);
		}
	});

	test("stays inert when neither isolation flag is set", async () => {
		const dir = tempDir("broski-guard-inert-");
		const saved = { test: process.env[TEST_ISOLATION_ENV], bench: process.env[BENCH_ISOLATION_ENV] };
		delete process.env[TEST_ISOLATION_ENV];
		delete process.env[BENCH_ISOLATION_ENV];
		try {
			expect(isIsolationActive()).toBe(false);
			const path = join(dir, "config.json");
			await writeConfig(getDefaultConfig(), path);
			expect(existsSync(path)).toBe(true);
		} finally {
			if (saved.test !== undefined) process.env[TEST_ISOLATION_ENV] = saved.test;
			if (saved.bench !== undefined) process.env[BENCH_ISOLATION_ENV] = saved.bench;
		}
	});

	test("every write site refuses the real home in a child process", () => {
		const fakeRealHome = tempDir("broski-guard-child-real-");
		const report = runChild(fakeRealHome, fakeRealHome);

		expect(report.home).toBe(resolve(fakeRealHome));
		expect(report.realHome).toBe(resolve(fakeRealHome));
		expect(report.isolationActive).toBe(true);
		expect(report.configPath.startsWith(resolve(fakeRealHome))).toBe(true);

		const refused = Object.entries(report.outcomes).map(([, outcome]) => outcome);
		expect(refused.length).toBeGreaterThanOrEqual(6);
		for (const outcome of refused) expect(outcome).toStartWith("threw:RealHomeWriteError");

		expect(existsSync(join(fakeRealHome, ".claude"))).toBe(false);
		expect(existsSync(join(fakeRealHome, ".broski"))).toBe(false);
		expect(existsSync(join(fakeRealHome, ".pi"))).toBe(false);
	});

	test("a genuinely temp home still installs the hooks", () => {
		const workHome = tempDir("broski-guard-child-work-");
		const fakeRealHome = tempDir("broski-guard-child-elsewhere-");
		const report = runChild(workHome, fakeRealHome);

		expect(report.home).toBe(resolve(workHome));
		expect(report.realHome).toBe(resolve(fakeRealHome));
		expect(report.outcomes.installCcHook).toBe("ok:done");
		expect(report.outcomes["writeConfig.defaultPath"]).toBe("ok:done");
		expect(existsSync(join(workHome, ".claude", "settings.json"))).toBe(true);

		expect(existsSync(join(fakeRealHome, ".claude"))).toBe(false);
	});
});
