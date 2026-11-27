import { homedir } from "node:os";
import { join } from "node:path";
import packageMeta from "../../package.json";
import { antigravityBackendFactory } from "../backends/antigravity/factory";
import { presenceDirOf } from "../backends/antigravity/install";
import { piBackendFactory } from "../backends/pi/factory";
import { defaultHoldersRoot } from "../backends/pi/holder/holders";
import { agentDirOf } from "../backends/pi/pi-install";
import { defaultLinkDirectory } from "../backends/pi/terminal/link";
import { type BroskiConfig, readConfig } from "../config";
import type { BackendFactory, BackendId } from "../contract";
import { fileLock } from "../platform/file-lock";
import { fitImageBase64 } from "../platform/image-fit";
import { bridgeEnv } from "../platform/shell-env";
import { machineStats } from "../stats/service";
import { machineSystem } from "../usage/system";
import { machineUsage } from "../usage/usage-reader";
import { resolveAgyCli } from "./antigravity-cli-path";
import type { BridgeMcp } from "./bridge-mcp";
import type { ClaudeCodeWiring } from "./claude-code-wiring";
import type { ContractOptions } from "./contract-seam";
import { phoneWriting } from "./phone-writing";
import { resolvePiCli } from "./pi-cli-path";
import { holderCommand } from "./pi-holder-command";
import { loadConfiguredAdapters } from "./plugin-loader";

/**
 * Pi as the user installed it, with the bridge's environment (the login shell's by the time backends start,
 * `platform/shell-env.ts`) and the link to terminal `pi` processes, unless the config turns it off (`pi.terminalLink`).
 */
const piBackend: ReturnType<typeof piBackendFactory> = async (host) => {
	const config = await readConfig();
	const env = bridgeEnv();
	return piBackendFactory({
		install: {
			cli: resolvePiCli(config.pi.cliPath),
			env,
			agentDir: agentDirOf(env),
			appendSystemPrompt: phoneWriting(config.phoneWriting),
		},
		hostDir: join(homedir(), ".broski", "pi"),
		holders: { root: defaultHoldersRoot(), command: holderCommand() },
		link: { enabled: config.pi.terminalLink !== false, directory: defaultLinkDirectory() },
		...(config.pi.maxSessions !== undefined && { maxHosted: config.pi.maxSessions }),
		fitImage: fitImageBase64,
	})(host);
};

/** The user's `agy`, with the bridge's environment, started in an empty folder the bridge owns (`antigravity/install.ts`). */
const antigravityBackend: ReturnType<typeof antigravityBackendFactory> = async (host) => {
	const config = await readConfig();
	const env = bridgeEnv();
	return antigravityBackendFactory({
		install: {
			cli: resolveAgyCli(config.antigravity.cliPath),
			env,
			voidDir: join(homedir(), ".broski", "antigravity", "void"),
			presenceDir: presenceDirOf(env),
			phoneNote: phoneWriting(config.phoneWriting),
		},
		bridgeVersion: packageMeta.version,
		fileLock,
		fitImage: fitImageBase64,
		...(config.antigravity.maxSessions !== undefined && { maxSessions: config.antigravity.maxSessions }),
	})(host);
};

export interface ContractBackendsDeps {
	readonly claudeCode: ClaudeCodeWiring;
	readonly config: BroskiConfig;
	readonly mcp: BridgeMcp;
	readonly log: (message: string) => void;
}

/**
 * The backends the bridge core serves, Pi, Claude Code, Antigravity and the config's third-party adapters, and the
 * usage of the plans they run on.
 */
export function contractOptions(deps: ContractBackendsDeps): ContractOptions {
	const builtIn: ReadonlyArray<readonly [BackendId, BackendFactory]> = [
		["pi", piBackend],
		["claude-code", deps.claudeCode.backend],
		["antigravity", antigravityBackend],
	];
	const plugins = loadConfiguredAdapters(
		deps.config.adapters,
		builtIn.map(([id]) => id),
		{
			env: bridgeEnv,
			mcp: (backend) => deps.mcp.issuer(backend),
			phoneWriting: phoneWriting(deps.config.phoneWriting),
			fitImage: fitImageBase64,
			stateRoot: join(homedir(), ".broski", "adapters"),
			log: deps.log,
		},
	);
	return {
		backends: [...builtIn, ...plugins],
		usage: (log) => machineUsage(machineSystem(agentDirOf(process.env)), join(homedir(), ".broski"), log),
		stats: (log) => machineStats(agentDirOf(process.env), join(homedir(), ".broski"), log),
	};
}
