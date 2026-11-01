/** The old PreToolUse hook in the user's `~/.claude/settings.json`; the edit is `cc_hook_file.ts`. */
import { homedir } from "node:os";
import { join } from "node:path";
import { CC_HOOK_MARKER, type HookInstallTarget, installCcHookAt, uninstallCcHookAt } from "./cc_hook_file";

export type { HookInstallTarget } from "./cc_hook_file";
export const HOOK_MARKER = CC_HOOK_MARKER;

/** Not `CLAUDE_CONFIG_DIR`: the old installer always edited the home's file. */
export function ccHookSettingsPath(): string {
	return join(homedir(), ".claude", "settings.json");
}

export async function installCcHook(target: HookInstallTarget & { settingsPath?: string }): Promise<void> {
	await installCcHookAt(target.settingsPath ?? ccHookSettingsPath(), target);
}

export async function uninstallCcHook(log?: (msg: string) => void, settingsPath = ccHookSettingsPath()): Promise<void> {
	await uninstallCcHookAt(settingsPath, log);
}
