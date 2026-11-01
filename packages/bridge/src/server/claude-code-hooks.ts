/**
 * The Claude Code permission hooks in the user's settings, set once the loopback listener is bound. Flag off (or no
 * wiring): the old protocol's `PreToolUse` hook, as before. `claudeCode.contract` on: a leftover old hook is taken out,
 * and the adapter's `PermissionRequest` hook (D26) is installed when `terminalAsks`, removed otherwise. A refusal is
 * logged and never stops the bridge.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { installTerminalHook, removeTerminalHook } from "../backends/claude-code/terminal/hook-install";
import { HOOK_PATH, TERMINAL_HOOK_TIMEOUT_SECONDS } from "../backends/claude-code/terminal/hook-settings";
import {
	ccHookSettingsPath,
	installCcHook,
	HOOK_MARKER as OLD_HOOK_MARKER,
	uninstallCcHook,
} from "../handlers/cc_hook_installer";
import { assertNotRealHome } from "../safety/real-home-guard";
import type { ClaudeCodeWiring } from "./claude-code-wiring";

export interface HookListener extends HookPlace {
	readonly port: number;
	readonly token: string;
}

/** Where the hooks are, for taking them out. */
export interface HookPlace {
	/** The loopback certificate, when the listener speaks TLS. */
	readonly certPath: string | undefined;
	readonly log: (message: string) => void;
	/** `CLAUDE_CONFIG_DIR`, else `~/.claude`: where the CLI reads the user's settings. */
	readonly configRoot?: string;
	/** The old installer's file and remover; tests point them at a temp home. */
	readonly oldHook?: { readonly file: string; readonly uninstall: (log: (message: string) => void) => Promise<void> };
}

export async function setClaudeCodeHooks(wiring: ClaudeCodeWiring | undefined, listener: HookListener): Promise<void> {
	const scheme = listener.certPath === undefined ? "http" : "https";
	if (!wiring?.contract) {
		if (wiring) await terminalHook(placeOf(listener));
		const settingsPath = listener.oldHook?.file;
		await installCcHook({
			port: listener.port,
			token: listener.token,
			scheme,
			log: listener.log,
			...(settingsPath !== undefined && { settingsPath }),
		});
		return;
	}
	await clearOldHook(listener);
	await terminalHook(wiring.terminalAsks ? listener : placeOf(listener));
}

function placeOf({ port: _port, token: _token, ...place }: HookListener): HookPlace {
	return place;
}

/** `broski uninstall`: both hooks out of the user's settings, so nothing is left pointing at a bridge that is gone. */
export async function removeClaudeCodeHooks(place: HookPlace): Promise<void> {
	await terminalHook(place);
	await clearOldHook(place);
}

/** Whether the old hook may be taken out at shutdown: only when this bridge installed it. */
export function keepsOldHook(wiring: ClaudeCodeWiring | undefined): boolean {
	return !wiring?.contract;
}

/** Ours installed when `listener` is a bound listener, else removed. */
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

/** The old installer's file is edited only when its hook is in it. */
async function clearOldHook(listener: HookPlace): Promise<void> {
	const { file, uninstall } = listener.oldHook ?? { file: ccHookSettingsPath(), uninstall: uninstallCcHook };
	const text = await readFile(file, "utf8").catch(() => "");
	if (!text.includes(OLD_HOOK_MARKER)) return;
	const { log } = listener;
	await uninstall(log).catch((error: unknown) => log(`[CC Hook] could not be taken out: ${String(error)}`));
}

function claudeConfigRoot(): string {
	return (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC");
}
