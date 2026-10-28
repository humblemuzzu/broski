/**
 * Probe script for `real-home-guard.test.ts`. Never a `bun test` file — the parent spawns it with a
 * controlled HOME so the probes cannot reach the developer's real `~/.claude`, `~/.codex` or
 * `~/.broski`. Prints one report line and always exits 0: the parent asserts on the outcomes.
 */

import { homedir, tmpdir } from "node:os";
import { createNewAuthState } from "../../auth-token";
import { getDefaultConfig } from "../../config/defaults";
import { getConfigPath, writeConfig } from "../../config/read-write";
import { PiDurableSessionStore } from "../../connectors/pi-durable/session-store";
import { installCcHook, uninstallCcHook } from "../../handlers/cc_hook_installer";
import { resolveIndexCacheRoot } from "../../index-cache/index-cache-root";
import { createBridgeLogger } from "../../logging/logger";
import { isIsolationActive, realHomeDir } from "../../safety/real-home-guard";
import { ensureTlsMaterial } from "../../tls";
import { GUARD_REPORT_PREFIX, type GuardProbeReport } from "./guard-probe-protocol";

type Probe = { name: string; work: () => Promise<unknown> };

const probes: Probe[] = [
	{ name: "installCcHook", work: () => installCcHook({ port: 1234, token: "guard-token", scheme: "https" }) },
	{ name: "uninstallCcHook", work: () => uninstallCcHook() },
	{ name: "writeConfig.defaultPath", work: () => writeConfig(getDefaultConfig()) },
	{ name: "createNewAuthState", work: () => createNewAuthState() },
	{ name: "ensureTlsMaterial", work: () => ensureTlsMaterial() },
	{ name: "piDurableCreate", work: () => new PiDurableSessionStore().create({ cwd: tmpdir() }) },
	{
		name: "resolveIndexCacheRoot",
		work: async () => {
			return resolveIndexCacheRoot();
		},
	},
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
