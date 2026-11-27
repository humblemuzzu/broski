/** The user's own `agy`, as the bridge found it, and what every `agy acp` the adapter starts runs with. */

import { homedir } from "node:os";
import { join } from "node:path";

export const AGY_INSTALL_PAGE = "https://antigravity.google/docs/install?tab=cli";
export const AGY_INSTALL_FIX = `Install Antigravity CLI (${AGY_INSTALL_PAGE}), or set "antigravity": {"cliPath": "/path/to/agy"} in ~/.broski/config.json`;
export const AGY_SIGN_IN_FIX = "Run `agy` in a terminal and sign in.";

export type AgyCli =
	| { readonly found: true; readonly path: string }
	| { readonly found: false; readonly reason: string };

export interface AgyInstall {
	readonly cli: AgyCli;
	/** The bridge's login-shell environment, which a terminal `agy` would have. */
	readonly env: Readonly<Record<string, string>>;
	/**
	 * An empty folder the bridge owns, where every `agy acp` starts: `session/list` reports its own folder for a
	 * session that stored no `cwd`, and this one is known to be no project's.
	 */
	readonly voidDir: string;
	/** Where a terminal `agy` holds `<sessionId>.lock` while it has that conversation open. */
	readonly presenceDir: string;
	/** Appended to the system prompt of every session the phone starts. */
	readonly phoneNote?: string;
}

export function presenceDirOf(env: Readonly<Record<string, string | undefined>>): string {
	return join(env.HOME || homedir(), ".gemini", "antigravity-cli", "presence");
}

/** The bridge's own empty folder for `agy`, under `~/.broski`. */
export function voidDirOf(home: string = homedir()): string {
	return join(home, ".broski", "antigravity", "void");
}
