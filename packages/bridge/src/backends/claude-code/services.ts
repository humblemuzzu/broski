/** The factory's options (what the server layer hands the adapter) and the services every part shares. */

import type { CustomToolsPort } from "./ports/custom-tools";
import type { ClaudeSdk } from "./ports/sdk";
import type { TerminalOptions } from "./ports/terminal";
import { type Clock, SYSTEM_CLOCK } from "./ports/time";
import { mayBypassPermissions, processUid } from "./process/bypass";
import { cliEnv } from "./process/env";
import { createClaudeSdk } from "./sdk/claude-sdk";

/** `server/claude-cli-path.ts`'s answer (D35), as a value: a missing binary is a `status()` issue, not a throw. */
export type CliLocation =
	| { readonly found: true; readonly path: string; readonly source: string }
	| { readonly found: false; readonly reason: string };

export interface ClaudeCodeFactoryOptions {
	readonly cli: CliLocation;
	/** Unset in production (D36): the bridge's own `CLAUDE_CONFIG_DIR`, else `~/.claude`. Tests: a temp dir. */
	readonly configDir?: string;
	/** The bridge's login-shell environment (`platform/shell-env.ts`). */
	readonly env: Readonly<Record<string, string>>;
	/** The owner journal and the catalogue cache: `~/.broski/claude-code/` in production. */
	readonly stateDir: string;
	/** `CLAUDE_AGENT_SDK_CLIENT_APP`, `broski/<version>` (D4). */
	readonly clientApp: string;
	/** The SDK package's `claudeCodeVersion`, baked in at build time (D3). */
	readonly expectedCliVersion?: string;
	readonly customTools?: CustomToolsPort;
	readonly terminal?: TerminalOptions;
	readonly clock?: Clock;
	/** Unit tests inject a fake; otherwise `createClaudeSdk`. */
	readonly sdk?: ClaudeSdk;
	/** Tests only: the uid the CLI runs as; otherwise the bridge's own. */
	readonly uid?: number;
}

export interface ClaudeCodeServices {
	readonly sdk: ClaudeSdk;
	readonly cli: CliLocation;
	readonly configDir: string | undefined;
	/** D4's environment for every CLI, `CLAUDE_CONFIG_DIR` included when `configDir` is set. */
	readonly cliEnv: Readonly<Record<string, string>>;
	/** `bypassPermissions` can be offered and its flag passed (`process/bypass.ts`). */
	readonly mayBypassPermissions: boolean;
	readonly stateDir: string;
	readonly expectedCliVersion: string | undefined;
	readonly customTools: CustomToolsPort | undefined;
	readonly terminal: TerminalOptions;
	readonly clock: Clock;
}

export function createClaudeCodeServices(options: ClaudeCodeFactoryOptions): ClaudeCodeServices {
	const env = cliEnv({ base: options.env, clientApp: options.clientApp, configDir: options.configDir });
	return {
		sdk: options.sdk ?? createClaudeSdk({ configDir: options.configDir, env }),
		cli: options.cli,
		configDir: options.configDir,
		cliEnv: env,
		mayBypassPermissions: mayBypassPermissions("uid" in options ? options.uid : processUid(), env),
		stateDir: options.stateDir,
		expectedCliVersion: options.expectedCliVersion,
		customTools: options.customTools,
		terminal: options.terminal ?? {},
		clock: options.clock ?? SYSTEM_CLOCK,
	};
}
