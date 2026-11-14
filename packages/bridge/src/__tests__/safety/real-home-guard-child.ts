/**
 * Probe script for `real-home-guard.test.ts`. Never a `bun test` file — the parent spawns it with a
 * controlled HOME so the probes cannot reach the developer's real `~/.claude` or
 * `~/.broski`. Prints one report line and always exits 0: the parent asserts on the outcomes.
 */

import { homedir } from "node:os";
import { createNewAuthState } from "../../auth-token";
import { getDefaultConfig } from "../../config/defaults";
import { getConfigPath, writeConfig } from "../../config/read-write";
import { createBridgeLogger } from "../../logging/logger";
import { isIsolationActive, realHomeDir } from "../../safety/real-home-guard";
import { setClaudeCodeTerminalHook } from "../../server/claude-code-hooks";
import { ensureTlsMaterial } from "../../tls";
import { GUARD_REPORT_PREFIX, type GuardProbeReport } from "./guard-probe-protocol";

type Probe = { name: string; work: () => Promise<unknown> };

/** The hook installer logs a refusal instead of throwing it, so the probe reports what it logged. */
async function terminalHookOutcome(): Promise<string> {
	const lines: string[] = [];
	const log = (line: string) => lines.push(line);
	await setClaudeCodeTerminalHook(true, { port: 1234, token: "guard-token", certPath: undefined, log });
	return lines.join("\n");
}

const probes: Probe[] = [
	{ name: "claudeCodeTerminalHook", work: terminalHookOutcome },
	{ name: "writeConfig.defaultPath", work: () => writeConfig(getDefaultConfig()) },
	{ name: "createNewAuthState", work: () => createNewAuthState() },
	{ name: "ensureTlsMaterial", work: () => ensureTlsMaterial() },
	{
		name: "createBridgeLogger",
		work: async () => {
			const logger = createBridgeLogger({ consoleLevel: "user", redirectProbe: () => false });
			await logger.flush();
			return "constructed";
		},
	},
];

function describe(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main(): Promise<void> {
	const outcomes: Record<string, string> = {};
	for (const probe of probes) {
		try {
			const value = await probe.work();
			outcomes[probe.name] = `ok:${typeof value === "string" ? value : "done"}`;
		} catch (error) {
			outcomes[probe.name] = `threw:${describe(error)}`;
		}
	}

	const report: GuardProbeReport = {
		home: homedir(),
		realHome: realHomeDir(),
		configPath: getConfigPath(),
		isolationActive: isIsolationActive(),
		outcomes,
	};
	process.stdout.write(`\n${GUARD_REPORT_PREFIX}${JSON.stringify(report)}\n`);
}

if (import.meta.main) await main();
