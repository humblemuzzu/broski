import packageMeta from "../../package.json";
import { getDefaultConfig } from "../config/defaults";
import type { BroskiConfig } from "../config/schema";

/** What a setup run asks about; everything else in the config is carried over from what was there. */
export interface SetupChoices {
	readonly port: number;
	readonly tls: boolean;
	readonly agents: BroskiConfig["agents"];
	readonly daemon: BroskiConfig["daemon"];
}

export function setupConfig(existing: BroskiConfig, choices: SetupChoices, now: Date = new Date()): BroskiConfig {
	const defaults = getDefaultConfig();
	return {
		...defaults,
		version: 1,
		wizard: {
			completedSetup: true,
			lastRunAt: now.toISOString(),
			lastRunVersion: packageMeta.version ?? "0.1.0",
		},
		network: { port: choices.port },
		security: { tls: choices.tls, verifyCodeSignature: defaults.security.verifyCodeSignature },
		agents: { claudeCode: choices.agents.claudeCode, pi: choices.agents.pi, antigravity: choices.agents.antigravity },
		daemon: { installed: choices.daemon.installed, type: choices.daemon.type },
		claudeCode: existing.claudeCode,
		pi: existing.pi,
		antigravity: existing.antigravity,
		phoneWriting: existing.phoneWriting,
		bridgeTools: existing.bridgeTools,
		adapters: existing.adapters,
	};
}
