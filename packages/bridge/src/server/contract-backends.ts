import { homedir } from "node:os";
import { join } from "node:path";
import { piBackendFactory } from "../backends/pi/factory";
import { agentDirOf } from "../backends/pi/pi-install";
import { defaultLinkDirectory } from "../backends/pi/terminal/link";
import { readConfig } from "../config";
import type { ClaudeCodeWiring } from "./claude-code-wiring";
import type { ContractOptions } from "./contract-seam";
import { resolvePiCli } from "./pi-cli-path";

/**
 * Pi as the user installed it, with the bridge's environment (the login shell's by the time backends start,
 * `platform/shell-env.ts`) and the link to terminal `pi` processes, unless the config turns it off (`pi.terminalLink`).
 */
const piBackend: ReturnType<typeof piBackendFactory> = async (host) => {
	const config = await readConfig();
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
	return piBackendFactory({
		install: { cli: resolvePiCli(config.pi.cliPath), env, agentDir: agentDirOf(env) },
		hostDir: join(homedir(), ".broski", "pi"),
		link: { enabled: config.pi.terminalLink !== false, directory: defaultLinkDirectory() },
	})(host);
};

/** The backends the bridge core serves: Pi and Claude Code. */
export function contractOptions(claudeCode: ClaudeCodeWiring): ContractOptions {
	return {
		backends: [
			["pi", piBackend],
			["claude-code", claudeCode.backend],
		],
	};
}
