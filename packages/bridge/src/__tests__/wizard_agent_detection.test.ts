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

function configured(claude?: string, pi?: string) {
	return BroskiConfigSchema.parse({
		version: 1,
		claudeCode: { ...(claude !== undefined && { cliPath: claude }) },
		pi: { ...(pi !== undefined && { cliPath: pi }) },
	});
}

describe("the wizard's agent detection", () => {
	test("finds a claude and a pi that only the config's cliPath keys name", () => {
		const claude = installed("claude");
		const pi = installed("pi");
		expect(detectAgents(configured(claude, pi), nothingOnPath)).toEqual({
			claudeCode: { found: true, path: claude },
			pi: { found: true, path: pi },
		});
	});

	test("falls back to PATH, and finds nothing where neither names one", () => {
		const onPath = (name: string) => `/usr/local/bin/${name}`;
		expect(detectAgents(configured("/missing/claude", "/missing/pi"), onPath)).toEqual({
			claudeCode: { found: true, path: "/usr/local/bin/claude" },
			pi: { found: true, path: "/usr/local/bin/pi" },
		});
		expect(detectAgents(configured(), nothingOnPath)).toEqual({
			claudeCode: { found: false, path: null },
			pi: { found: false, path: null },
		});
	});
});
