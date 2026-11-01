/**
 * CC Hook Installer.
 *
 * Manages the Broski PreToolUse hook in ~/.claude/settings.json.
 * The hook proxies permission requests through the bridge to the phone app,
 * allowing users to approve/deny CC tool use from their phone.
 *
 * The hook is installed on bridge startup and uninstalled on shutdown.
 * If the bridge is unreachable, the hook returns {} (no-op) so CC shows
 * its normal terminal dialog — safe degradation.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertNotRealHome } from "../safety/real-home-guard";

export const HOOK_MARKER = "broski-permission-proxy";

/** The file this installer edits: `~/.claude/settings.json`, whatever `CLAUDE_CONFIG_DIR` says. */
export function ccHookSettingsPath(): string {
	return join(homedir(), ".claude", "settings.json");
}

/** The loopback listener the hook calls: its real scheme, never an assumed one. */
export type HookInstallTarget = {
	port: number;
	token: string;
	scheme: "http" | "https";
	log?: (message: string) => void;
};

/**
 * Install the Broski PreToolUse hook into ~/.claude/settings.json.
 * If a hook with our marker already exists, it is updated in place.
 * Otherwise a new entry is prepended (runs first).
 */
export async function installCcHook(target: HookInstallTarget): Promise<void> {
	const { log } = target;
	const settingsPath = ccHookSettingsPath();
	assertNotRealHome(settingsPath, "cc hook install");

	let settings: Record<string, unknown> = {};
	try {
		const content = await readFile(settingsPath, "utf-8");
		settings = JSON.parse(content) as Record<string, unknown>;
	} catch {
		// File doesn't exist or invalid JSON — create fresh
		await mkdir(join(homedir(), ".claude"), { recursive: true });
	}

	if (!settings.hooks || typeof settings.hooks !== "object") {
		settings.hooks = {};
	}
	const hooks = settings.hooks as Record<string, unknown>;

	// Build the hook command — inline curl, no external script needed
	const hookCommand = buildHookCommand(target);

	const hookEntry: Record<string, unknown> = {
		hooks: [
			{
				type: "command",
				command: hookCommand,
			},
		],
		timeout: 50, // 45s hook timeout + 5s buffer
	};

	// Install ONLY for PreToolUse — it fires for every tool and supports both
	// permissionDecision (allow/deny/ask) and updatedInput (for AskUserQuestion
	// answers). Installing PermissionRequest too causes duplicate waiters —
	// when the user answers on the phone, only one waiter resolves, the other
	// times out and CC falls back to the terminal dialog.
	installHookForEvent(hooks, "PreToolUse", hookEntry);

	// Clean up any leftover PermissionRequest hook from previous versions
	removeHookFromEvent(hooks, "PermissionRequest");

	await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	(log ?? console.log)(`[CC Hook] Installed PreToolUse hook in ${settingsPath}`);
}

/**
 * Install or update a hook entry for a specific event type.
 */
function installHookForEvent(
	hooks: Record<string, unknown>,
	eventName: string,
	hookEntry: Record<string, unknown>,
): void {
	if (!Array.isArray(hooks[eventName])) {
		hooks[eventName] = [];
	}
	const eventHooks = hooks[eventName] as Array<Record<string, unknown>>;

	const existingIdx = eventHooks.findIndex((matcher) => {
		const matcherHooks = matcher.hooks;
		if (!Array.isArray(matcherHooks)) return false;
		return matcherHooks.some(
			(h: Record<string, unknown>) => typeof h.command === "string" && h.command.includes(HOOK_MARKER),
		);
	});

	if (existingIdx >= 0) {
		eventHooks[existingIdx] = hookEntry;
	} else {
		eventHooks.unshift(hookEntry);
	}
}

/**
 * Remove our hook entry from a specific event type.
 */
function removeHookFromEvent(hooks: Record<string, unknown>, eventName: string): void {
	if (!Array.isArray(hooks[eventName])) return;
	hooks[eventName] = (hooks[eventName] as Array<Record<string, unknown>>).filter((matcher) => {
		const matcherHooks = matcher.hooks;
		if (!Array.isArray(matcherHooks)) return true;
		return !matcherHooks.some(
			(h: Record<string, unknown>) => typeof h.command === "string" && h.command.includes(HOOK_MARKER),
		);
	});
	if ((hooks[eventName] as unknown[]).length === 0) {
		delete hooks[eventName];
	}
}

/**
 * Uninstall Broski hooks from ~/.claude/settings.json.
 * Removes both PreToolUse and PermissionRequest hooks.
 */
export async function uninstallCcHook(log?: (msg: string) => void): Promise<void> {
	const settingsPath = ccHookSettingsPath();
	assertNotRealHome(settingsPath, "cc hook uninstall");

	try {
		const content = await readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content) as Record<string, unknown>;

		if (settings?.hooks && typeof settings.hooks === "object") {
			const hooks = settings.hooks as Record<string, unknown>;
			removeHookFromEvent(hooks, "PreToolUse");
			removeHookFromEvent(hooks, "PermissionRequest");
			// Clean up empty hooks object
			if (Object.keys(hooks).length === 0) {
				delete settings.hooks;
			}
			await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
			(log ?? console.log)(`[CC Hook] Uninstalled hooks from ${settingsPath}`);
		}
	} catch {
		// File doesn't exist or parse error — nothing to uninstall
	}
}

/**
 * Build the inline bash command that reads CC's hook stdin and posts to the bridge.
 * The HOOK_MARKER is embedded in a comment so we can find/update our hook entry.
 */
function buildHookCommand(target: HookInstallTarget): string {
	const { port, token, scheme } = target;
	// Multi-line for readability in settings.json, but functionally a single command.
	// Uses bash -c with a heredoc-style inline script.
	return [
		`bash -c '`,
		`# ${HOOK_MARKER}`,
		`INPUT=$(cat)`,
		`RESP=$(curl -sk --max-time 45 -X POST "${scheme}://127.0.0.1:${port}/cc-hook"`,
		` -H "Content-Type: application/json"`,
		` -H "Authorization: Bearer ${token}"`,
		` -d "$INPUT" 2>/dev/null) || true`,
		`[ -n "$RESP" ] && echo "$RESP" || echo "{}"`,
		`'`,
	].join("\n");
}
