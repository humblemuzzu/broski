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
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const HOOK_MARKER = "broski-permission-proxy";

/**
 * Install the Broski PreToolUse hook into ~/.claude/settings.json.
 * If a hook with our marker already exists, it is updated in place.
 * Otherwise a new entry is prepended (runs first).
 */
export async function installCcHook(bridgePort: number, authToken: string, log?: (msg: string) => void): Promise<void> {
	const settingsPath = join(homedir(), ".claude", "settings.json");

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
	const hookCommand = buildHookCommand(bridgePort, authToken);

	const hookEntry: Record<string, unknown> = {
		hooks: [
			{
				type: "command",
				command: hookCommand,
			},
		],
		timeout: 310, // 5 min + 10s buffer (must exceed HOOK_PERMISSION_TIMEOUT_MS)
	};

	// Install for PreToolUse (tool execution approval — Bash, Write, Edit, etc.)
	installHookForEvent(hooks, "PreToolUse", hookEntry);

	// Install for PermissionRequest (permission dialogs incl. AskUserQuestion, user questions)
	installHookForEvent(hooks, "PermissionRequest", hookEntry);

	await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	(log ?? console.log)(`[CC Hook] Installed PreToolUse + PermissionRequest hooks in ${settingsPath}`);
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
	const settingsPath = join(homedir(), ".claude", "settings.json");

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
function buildHookCommand(port: number, token: string): string {
	// Multi-line for readability in settings.json, but functionally a single command.
	// Uses bash -c with a heredoc-style inline script.
	return [
		`bash -c '`,
		`# ${HOOK_MARKER}`,
		`INPUT=$(cat)`,
		`RESP=$(curl -s --max-time 310 -X POST "http://127.0.0.1:${port}/cc-hook"`,
		` -H "Content-Type: application/json"`,
		` -H "Authorization: Bearer ${token}"`,
		` -d "$INPUT" 2>/dev/null) || true`,
		`[ -n "$RESP" ] && echo "$RESP" || echo "{}"`,
		`'`,
	].join("\n");
}
