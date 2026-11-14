/**
 * The Claude Code terminal hook in the user's settings (adapter README D29), set once the loopback listener is bound:
 * the adapter's `PermissionRequest` hook is installed while `claudeCode.terminalAsks` is on and removed otherwise. A
 * refusal is logged and never stops the bridge.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { installTerminalHook, removeTerminalHook } from "../backends/claude-code/terminal/hook-install";
import { HOOK_PATH, TERMINAL_HOOK_TIMEOUT_SECONDS } from "../backends/claude-code/terminal/hook-settings";
import { assertNotRealHome } from "../safety/real-home-guard";

/** Where the hook is, for taking it out. */
export interface HookPlace {
	/** The loopback certificate, when the listener speaks TLS. */
	readonly certPath: string | undefined;
	readonly log: (message: string) => void;
	/** `CLAUDE_CONFIG_DIR`, else `~/.claude`: where the CLI reads the user's settings. */
	readonly configRoot?: string;
}

export interface HookListener extends HookPlace {
	readonly port: number;
	readonly token: string;
}

export async function setClaudeCodeTerminalHook(terminalAsks: boolean, listener: HookListener): Promise<void> {
	await terminalHook(terminalAsks ? listener : placeOf(listener));
}

/** `broski uninstall`: the hook out of the user's settings, so nothing is left pointing at a bridge that is gone. */
export async function removeClaudeCodeTerminalHook(place: HookPlace): Promise<void> {
	await terminalHook(place);
}

function placeOf({ port: _port, token: _token, ...place }: HookListener): HookPlace {
	return place;
}

/** Installed when `listener` is a bound listener, else removed. */
async function terminalHook(listener: HookPlace | HookListener): Promise<void> {
	const configRoot = listener.configRoot ?? claudeConfigRoot();
	try {
		assertNotRealHome(join(configRoot, "settings.json"), "claude code terminal hook");
		const result =
			"port" in listener
				? await installTerminalHook(configRoot, {
						url: `${listener.certPath === undefined ? "http" : "https"}://127.0.0.1:${listener.port}${HOOK_PATH}`,
						token: listener.token,
						timeoutSeconds: TERMINAL_HOOK_TIMEOUT_SECONDS,
						...(listener.certPath !== undefined && { caCertPath: listener.certPath }),
					})
				: await removeTerminalHook(configRoot, listener.certPath);
		const why = result.status === "refused" ? `: ${result.reason}` : "";
		listener.log(`[CC terminal hook] ${result.status} in ${result.path}${why}`);
	} catch (error) {
		listener.log(`[CC terminal hook] not changed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function claudeConfigRoot(): string {
	return (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC");
}
