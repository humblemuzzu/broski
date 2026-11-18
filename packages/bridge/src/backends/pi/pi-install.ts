/** The user's own `pi`, as the bridge found it, and what every `pi` the adapter starts runs with. */

import { homedir } from "node:os";
import { join } from "node:path";
import { expandPath } from "./pi-paths";

/** How a user installs Pi: every message that sends them to it says this. */
export const PI_INSTALL_COMMAND = "npm i -g @earendil-works/pi-coding-agent";
export const PI_INSTALL_FIX = `Install Pi (${PI_INSTALL_COMMAND}), or set "pi": {"cliPath": "/path/to/pi"} in ~/.broski/config.json`;
export const PI_UPDATE_FIX = `Update Pi: ${PI_INSTALL_COMMAND}`;

export type PiCli =
	| { readonly found: true; readonly path: string }
	| { readonly found: false; readonly reason: string };

export interface PiInstall {
	readonly cli: PiCli;
	/** The bridge's login-shell environment, which a terminal `pi` would have. */
	readonly env: Readonly<Record<string, string>>;
	/** Where Pi keeps its configuration and sessions for that environment. */
	readonly agentDir: string;
	/** Added to the end of Pi's system prompt in every session the adapter hosts, by the bridge's extension. */
	readonly appendSystemPrompt?: string;
}

/** `$PI_CODING_AGENT_DIR` with `~` expanded, else `~/.pi/agent` (pi-coding-agent 1.5.2 `dist/config.js:495-516`). */
export function agentDirOf(env: Readonly<Record<string, string | undefined>>): string {
	const home = env.HOME || homedir();
	const configured = env.PI_CODING_AGENT_DIR;
	return (configured && expandPath(configured, home)) || join(home, ".pi", "agent");
}

/**
 * The environment of a `pi` the adapter starts: the bridge's, with Pi's automatic network activity off unless the user
 * set `PI_OFFLINE` themselves. Started with it on, Pi installs no missing npm or git package and refreshes no model
 * catalog from the network while it starts under a phone's request (pi-coding-agent 1.5.2
 * `docs/environment-variables.md:84`, `dist/core/package-manager.js`); `pi` run in a terminal still installs them.
 */
export function childEnv(install: PiInstall): Readonly<Record<string, string>> {
	return install.env.PI_OFFLINE === undefined ? { ...install.env, PI_OFFLINE: "1" } : install.env;
}
