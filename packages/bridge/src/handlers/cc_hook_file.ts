/**
 * The old protocol's PreToolUse hook in a Claude settings file, edited strictly (`utils/json-object-edit.ts`): a file
 * that does not parse, or whose rewrite would change data, is left byte for byte; every other key survives. The hook
 * proxies a permission request to the phone; an unreachable bridge answers `{}`, so the terminal asks as usual.
 */
import { roundTripProblem } from "../backends/claude-code/files/json-round-trip";
import { assertNotRealHome } from "../safety/real-home-guard";
import { isJsonObject } from "../utils/json-object";
import { editJsonObjectFile, type JsonEditResult } from "../utils/json-object-edit";

export const CC_HOOK_MARKER = "broski-permission-proxy";
const NEW_FILE_MODE = 0o600;

/** The loopback listener the hook calls: its real scheme, never an assumed one. */
export type HookInstallTarget = {
	port: number;
	token: string;
	scheme: "http" | "https";
	log?: (message: string) => void;
};

/** Our entry first in PreToolUse (updated in place when there), and none left in PermissionRequest. */
export async function installCcHookAt(settingsPath: string, target: HookInstallTarget): Promise<void> {
	assertNotRealHome(settingsPath, "cc hook install");
	const hookEntry = {
		hooks: [{ type: "command", command: buildHookCommand(target) }],
		timeout: 50, // 45s hook timeout + 5s buffer
	};
	const result = await editJsonObjectFile(
		settingsPath,
		(settings) => {
			const hooks = hooksOf(settings, true);
			if (typeof hooks !== "object") return hooks ?? false;
			// Install ONLY for PreToolUse — it fires for every tool and supports both
			// permissionDecision (allow/deny/ask) and updatedInput (for AskUserQuestion
			// answers). Installing PermissionRequest too causes duplicate waiters —
			// when the user answers on the phone, only one waiter resolves, the other
			// times out and CC falls back to the terminal dialog.
			const installed = installHookForEvent(hooks, "PreToolUse", hookEntry);
			if (typeof installed === "string") return installed;
			const removed = removeHookFromEvent(hooks, "PermissionRequest");
			return typeof removed === "string" ? removed : installed || removed;
		},
		{ createMode: NEW_FILE_MODE, lossy: roundTripProblem },
	);
	report(result, "Installed PreToolUse hook", target.log);
}

/** Our entries out of PreToolUse and PermissionRequest; a file without them is not rewritten. */
export async function uninstallCcHookAt(settingsPath: string, log?: (msg: string) => void): Promise<void> {
	assertNotRealHome(settingsPath, "cc hook uninstall");
	const result = await editJsonObjectFile(
		settingsPath,
		(settings) => {
			const hooks = hooksOf(settings, false);
			if (typeof hooks !== "object") return hooks ?? false;
			const fromPre = removeHookFromEvent(hooks, "PreToolUse");
			if (typeof fromPre === "string") return fromPre;
			const fromRequest = removeHookFromEvent(hooks, "PermissionRequest");
			if (typeof fromRequest === "string") return fromRequest;
			if (Object.keys(hooks).length === 0) delete settings.hooks;
			return fromPre || fromRequest;
		},
		{ lossy: roundTripProblem },
	);
	report(result, "Uninstalled hooks", log);
}

function report(result: JsonEditResult, done: string, log: ((message: string) => void) | undefined): void {
	const say = log ?? console.log;
	if (result.status === "changed") say(`[CC Hook] ${done} in ${result.path}`);
	if (result.status === "refused") say(`[CC Hook] ${result.path} not changed: ${result.reason}`);
}

/** The settings' `hooks` object (made when `create`), or why it cannot be edited; undefined: there is none. */
function hooksOf(settings: Record<string, unknown>, create: boolean): Record<string, unknown> | string | undefined {
	if (settings.hooks === undefined) {
		if (!create) return undefined;
		settings.hooks = {};
	}
	return isJsonObject(settings.hooks) ? settings.hooks : "its hooks setting is not an object";
}

function eventList(hooks: Record<string, unknown>, eventName: string): unknown[] | string | undefined {
	const list = hooks[eventName];
	if (list === undefined) return undefined;
	return Array.isArray(list) ? list : `its ${eventName} hooks are not a list`;
}

function isOurs(matcher: unknown): boolean {
	if (!isJsonObject(matcher) || !Array.isArray(matcher.hooks)) return false;
	return matcher.hooks.some(
		(hook: unknown) => isJsonObject(hook) && typeof hook.command === "string" && hook.command.includes(CC_HOOK_MARKER),
	);
}

/** Install or update a hook entry for a specific event type; whether anything changed. */
function installHookForEvent(
	hooks: Record<string, unknown>,
	eventName: string,
	hookEntry: Record<string, unknown>,
): boolean | string {
	const list = eventList(hooks, eventName) ?? [];
	if (typeof list === "string") return list;
	const existingIdx = list.findIndex(isOurs);
	if (existingIdx >= 0 && JSON.stringify(list[existingIdx]) === JSON.stringify(hookEntry)) return false;
	if (existingIdx >= 0) list[existingIdx] = hookEntry;
	else list.unshift(hookEntry);
	hooks[eventName] = list;
	return true;
}

/** Remove our hook entry from a specific event type; whether anything changed. */
function removeHookFromEvent(hooks: Record<string, unknown>, eventName: string): boolean | string {
	const list = eventList(hooks, eventName);
	if (list === undefined) return false;
	if (typeof list === "string") return list;
	const kept = list.filter((matcher) => !isOurs(matcher));
	if (kept.length === list.length) return false;
	if (kept.length === 0) delete hooks[eventName];
	else hooks[eventName] = kept;
	return true;
}

/**
 * Build the inline bash command that reads CC's hook stdin and posts to the bridge.
 * The marker is embedded in a comment so we can find/update our hook entry.
 */
function buildHookCommand(target: HookInstallTarget): string {
	const { port, token, scheme } = target;
	// Multi-line for readability in settings.json, but functionally a single command.
	// Uses bash -c with a heredoc-style inline script.
	return [
		`bash -c '`,
		`# ${CC_HOOK_MARKER}`,
		`INPUT=$(cat)`,
		`RESP=$(curl -sk --max-time 45 -X POST "${scheme}://127.0.0.1:${port}/cc-hook"`,
		` -H "Content-Type: application/json"`,
		` -H "Authorization: Bearer ${token}"`,
		` -d "$INPUT" 2>/dev/null) || true`,
		`[ -n "$RESP" ] && echo "$RESP" || echo "{}"`,
		`'`,
	].join("\n");
}
