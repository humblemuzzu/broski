/**
 * Codex Hook Installer.
 *
 * Manages the Broski PreToolUse hook in ~/.codex/hooks.json.
 * The hook proxies permission requests through the bridge to the phone app,
 * allowing users to approve/deny Codex tool use from their phone.
 *
 * Also ensures the `codex_hooks = true` feature flag is set in ~/.codex/config.toml,
 * since Codex hooks are experimental and gated behind that flag.
 *
 * The hook is installed on bridge startup and uninstalled on shutdown.
 * If the bridge is unreachable, the hook returns {} (no-op) so Codex shows
 * its normal terminal dialog — safe degradation.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOOK_MARKER = "broski-cx-permission-proxy";

/**
 * Install the Broski PreToolUse hook into ~/.codex/hooks.json.
 * If a hook with our marker already exists, it is updated in place.
 * Otherwise a new entry is prepended (runs first).
 */
export async function installCxHook(bridgePort: number, authToken: string, log?: (msg: string) => void): Promise<void> {
	const codexDir = join(homedir(), ".codex");
	const hooksPath = join(codexDir, "hooks.json");
	const configPath = join(codexDir, "config.toml");

	await mkdir(codexDir, { recursive: true });

	// 1. Ensure codex_hooks feature flag is enabled in config.toml
	await ensureHooksEnabled(configPath, log);

	// 2. Install the hook in hooks.json
	let hooksConfig: Record<string, unknown> = {};
	try {
		const content = await readFile(hooksPath, "utf-8");
		hooksConfig = JSON.parse(content) as Record<string, unknown>;
	} catch {
		// File doesn't exist or invalid JSON — create fresh
	}

	if (!hooksConfig.hooks || typeof hooksConfig.hooks !== "object") {
		hooksConfig.hooks = {};
	}
	const hooks = hooksConfig.hooks as Record<string, unknown>;

	if (!Array.isArray(hooks.PreToolUse)) {
		hooks.PreToolUse = [];
	}
	const preToolUse = hooks.PreToolUse as Array<Record<string, unknown>>;

	// Check if our hook is already installed
	const existingIdx = preToolUse.findIndex((matcher) => {
		const matcherHooks = matcher.hooks;
		if (!Array.isArray(matcherHooks)) return false;
		return matcherHooks.some(
			(h: Record<string, unknown>) => typeof h.command === "string" && h.command.includes(HOOK_MARKER),
		);
	});

	// Build the hook command — inline curl, no external script needed
	const hookCommand = buildHookCommand(bridgePort, authToken);

	const hookEntry: Record<string, unknown> = {
		matcher: "Bash",
		hooks: [
			{
				type: "command",
				command: hookCommand,
			},
		],
		timeout: 310, // 5 min + 10s buffer (must exceed HOOK_PERMISSION_TIMEOUT_MS)
	};

	if (existingIdx >= 0) {
		// Update existing entry
		preToolUse[existingIdx] = hookEntry;
	} else {
		// Prepend so our hook runs first
		preToolUse.unshift(hookEntry);
	}

	await writeFile(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);
	(log ?? console.log)(`[CX Hook] Installed PreToolUse hook in ${hooksPath}`);
}

/**
 * Uninstall the Broski PreToolUse hook from ~/.codex/hooks.json.
 * Safe to call even if the hook was never installed.
 */
export async function uninstallCxHook(log?: (msg: string) => void): Promise<void> {
	const hooksPath = join(homedir(), ".codex", "hooks.json");

	try {
		const content = await readFile(hooksPath, "utf-8");
		const hooksConfig = JSON.parse(content) as Record<string, unknown>;

		if (hooksConfig?.hooks && typeof hooksConfig.hooks === "object") {
			const hooks = hooksConfig.hooks as Record<string, unknown>;
			if (Array.isArray(hooks.PreToolUse)) {
				hooks.PreToolUse = (hooks.PreToolUse as Array<Record<string, unknown>>).filter((matcher) => {
					const matcherHooks = matcher.hooks;
					if (!Array.isArray(matcherHooks)) return true;
					return !matcherHooks.some(
						(h: Record<string, unknown>) => typeof h.command === "string" && h.command.includes(HOOK_MARKER),
					);
				});
				if ((hooks.PreToolUse as unknown[]).length === 0) {
					delete hooks.PreToolUse;
				}
				// Clean up empty hooks object
				if (Object.keys(hooks).length === 0) {
					delete hooksConfig.hooks;
				}
				await writeFile(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);
				(log ?? console.log)(`[CX Hook] Uninstalled PreToolUse hook from ${hooksPath}`);
			}
		}
	} catch {
		// File doesn't exist or parse error — nothing to uninstall
	}
}

/**
 * Ensure the `codex_hooks = true` feature flag is set in config.toml.
 * Without this flag, Codex ignores hooks.json entirely.
 */
async function ensureHooksEnabled(configPath: string, log?: (msg: string) => void): Promise<void> {
	let content = "";
	try {
		content = await readFile(configPath, "utf-8");
	} catch {
		// File doesn't exist — will create
	}

	// Check if codex_hooks is already enabled
	if (content.includes("codex_hooks") && content.includes("true")) return;

	// Add or update the feature flag
	if (content.includes("[features]")) {
		// Add under existing [features] section
		if (!content.includes("codex_hooks")) {
			content = content.replace("[features]", "[features]\ncodex_hooks = true");
		}
	} else {
		// Add new [features] section
		content = `${content.trimEnd()}\n\n[features]\ncodex_hooks = true\n`;
	}

	await writeFile(configPath, content);
	(log ?? console.log)(`[CX Hook] Enabled codex_hooks in ${configPath}`);
}

/**
 * Build the inline bash command that reads Codex's hook stdin and posts to the bridge.
 * The HOOK_MARKER is embedded in a comment so we can find/update our hook entry.
 */
function buildHookCommand(port: number, token: string): string {
	return [
		`bash -c '`,
		`# ${HOOK_MARKER}`,
		`INPUT=$(cat)`,
		`RESP=$(curl -sk --max-time 45 -X POST "https://127.0.0.1:${port}/cx-hook"`,
		` -H "Content-Type: application/json"`,
		` -H "Authorization: Bearer ${token}"`,
		` -d "$INPUT" 2>/dev/null) || true`,
		`[ -n "$RESP" ] && echo "$RESP" || echo "{}"`,
		`'`,
	].join("\n");
}
