/** The wizard offers the agents the bridge would run: the ones its config's `cliPath` keys and `PATH` resolve. */

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BroskiConfigSchema } from "../config/schema";
import { detectAgents } from "../wizard/steps/agents";

const nothingOnPath = () => null;

function installed(name: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "broski-wizard-")), name);
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
	return path;
}

function configured(claude?: string, pi?: string, agy?: string) {
	return BroskiConfigSchema.parse({
		version: 1,
		claudeCode: { ...(claude !== undefined && { cliPath: claude }) },
		pi: { ...(pi !== undefined && { cliPath: pi }) },
		antigravity: { ...(agy !== undefined && { cliPath: agy }) },
	});
}

describe("the wizard's agent detection", () => {
	test("finds a claude, a pi and an agy that only the config's cliPath keys name", () => {
		const claude = installed("claude");
		const pi = installed("pi");
		const agy = installed("agy");
		expect(detectAgents(configured(claude, pi, agy), nothingOnPath)).toEqual({
			claudeCode: { found: true, path: claude },
			pi: { found: true, path: pi },
			antigravity: { found: true, path: agy },
		});
	});

	test("falls back to PATH, and finds nothing where neither names one", () => {
		const onPath = (name: string) => `/usr/local/bin/${name}`;
		expect(detectAgents(configured("/missing/claude", "/missing/pi", "/missing/agy"), onPath)).toEqual({
			claudeCode: { found: true, path: "/usr/local/bin/claude" },
			pi: { found: true, path: "/usr/local/bin/pi" },
			antigravity: { found: true, path: "/usr/local/bin/agy" },
		});
		expect(detectAgents(configured(), nothingOnPath)).toEqual({
			claudeCode: { found: false, path: null },
			pi: { found: false, path: null },
			antigravity: { found: false, path: null },
		});
	});
});
