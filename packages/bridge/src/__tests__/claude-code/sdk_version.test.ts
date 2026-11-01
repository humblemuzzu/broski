/**
 * The CLI version a compiled bridge expects comes from a JSON import of the SDK package by a relative `node_modules`
 * path (the package's `exports` map has no `./package.json`). This fails when that import stops resolving to the
 * installed SDK, or when the bridge's exact pin is not the SDK that is installed.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { EXPECTED_CLAUDE_CLI_VERSION } from "../../server/claude-code-backend";

const require = createRequire(import.meta.url);

test("the expected CLI version is the installed SDK's claudeCodeVersion, under the exact pin", () => {
	const entry = require.resolve("@anthropic-ai/claude-agent-sdk");
	const installed = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8"));
	const bridge = JSON.parse(readFileSync(join(import.meta.dir, "../../../package.json"), "utf8"));
	expect(EXPECTED_CLAUDE_CLI_VERSION).toBe(installed.claudeCodeVersion);
	expect(EXPECTED_CLAUDE_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	expect(bridge.dependencies["@anthropic-ai/claude-agent-sdk"]).toBe(installed.version);
});
