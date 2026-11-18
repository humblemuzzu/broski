/**
 * Pure half of login-shell environment resolution: the command a shell is asked to run, reading
 * its marked NUL-separated output, and the rules that decide which variable wins on import.
 *
 * Kept apart from `shell-env.ts` so parsing and the merge rules are testable without spawning a
 * shell. Nothing here reads process state.
 */

import { delimiter } from "node:path";

/**
 * Set for the resolving shell only. A well-behaved rc file can check it to skip prompts, banners,
 * `tmux`/`zellij` auto-attach guards and p10k instant prompt, so the bridge gets the environment
 * without a terminal.
 */
export const SHELL_ENV_FLAG = "BROSKI_RESOLVING_SHELL_ENV";

const MARKER_PREFIX = "__BROSKI_SHELL_ENV_";

export type ShellDialect = "zsh" | "bash" | "fish" | "posix";

/** Shells that exist to refuse a login; asking them for an environment can never work. */
const REFUSING_SHELLS = new Set(["nologin", "false", "sync", "shutdown", "halt", "reboot"]);

const POSIX_SHELLS = new Set(["sh", "dash", "ksh", "ksh93", "ash", "mksh", "yash", "posh"]);

export function isRefusingShell(shellPath: string): boolean {
	return REFUSING_SHELLS.has(executableName(shellPath));
}

export function shellDialect(shellPath: string): ShellDialect | null {
	const name = executableName(shellPath);
	if (name === "zsh") return "zsh";
	if (name === "bash") return "bash";
	if (name === "fish") return "fish";
	if (POSIX_SHELLS.has(name)) return "posix";
	return null;
}

function executableName(shellPath: string): string {
	const base = shellPath.split(/[\\/]/).pop() ?? shellPath;
	return base.replace(/^-/, "").toLowerCase();
}

export function newMarker(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return `${MARKER_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}__`;
}

/**
 * `env -0` keeps a value's newlines intact, and the marker brackets whatever the rc files printed on
 * either side of it. The marker is echoed as a literal: an rc file that runs `set -u` cannot break it.
 */
export function shellCommand(marker: string): string {
	return `printf '%s' '${marker}'; env -0; printf '%s' '${marker}'`;
}

export function shellArgs(shellPath: string, command: string): string[] {
	const dialect = shellDialect(shellPath);
	if (dialect === "fish") return ["-l", "-i", "-c", command];
	return ["-i", "-l", "-c", command];
}

export type ParsedShellEnv = { ok: true; env: Record<string, string> } | { ok: false; reason: string };

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Reads the payload between the two markers. Anything an rc file printed before the first marker or
 * after the second is discarded, so banners and prompts cannot corrupt the result.
 */
export function parseMarkedEnv(raw: string, marker: string): ParsedShellEnv {
	const start = raw.indexOf(marker);
	if (start < 0) return { ok: false, reason: "the shell never printed its environment" };

	const payloadStart = start + marker.length;
	const end = raw.indexOf(marker, payloadStart);
	if (end < 0) return { ok: false, reason: "the shell's environment output was truncated" };

	const env: Record<string, string> = {};
	for (const entry of raw.slice(payloadStart, end).split("\0")) {
		if (!entry) continue;
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		const name = entry.slice(0, separator);
		if (!VARIABLE_NAME.test(name)) continue;
		env[name] = entry.slice(separator + 1);
	}

	const count = Object.keys(env).length;
	if (count === 0) return { ok: false, reason: "the shell printed no variables" };
	return { ok: true, env };
}

/**
 * Shell-run artefacts, not settings: the shell's own idea of the working directory, its bookkeeping,
 * the flags this resolver set, and the terminal identity of a terminal that is not there.
 */
export const SHELL_NOISE_NAMES: ReadonlySet<string> = new Set([
	"PWD",
	"OLDPWD",
	"SHLVL",
	"_",
	"TERM",
	"ZSH_EXECUTION_STRING",
	"BASH_EXECUTION_STRING",
	"FISH_EXECUTION_STRING",
	SHELL_ENV_FLAG,
]);

export const SHELL_NOISE_PREFIXES: readonly string[] = ["TERM_PROGRAM", "ITERM_", "WT_SESSION", "TMUX", "STY"];

export function isShellNoise(name: string): boolean {
	if (SHELL_NOISE_NAMES.has(name)) return true;
	return SHELL_NOISE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Names the bridge owns. The service value wins where the service set one; a compiled binary never takes them
 * from an rc file at all, so nothing in `~/.zshrc` can flip a switch the build hardened.
 */
export const BRIDGE_OWNED_NAMES: ReadonlySet<string> = new Set(["HOME", "NODE_ENV"]);

export const BRIDGE_OWNED_PREFIXES: readonly string[] = ["BROSKI_", "BUN_"];

export function isBridgeOwned(name: string): boolean {
	if (BRIDGE_OWNED_NAMES.has(name)) return true;
	return BRIDGE_OWNED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * What a new terminal inherits from the user's login session before its shell runs: who and where the user is,
 * the locale, the ssh agent, and on Linux the desktop session. The process that started the bridge can carry
 * anything besides (a tmux server keeps the environment of whoever started it, and an agent's command may have
 * exported its own role), and an agent the bridge runs would take it for the user's setting.
 */
export const SESSION_NAMES: ReadonlySet<string> = new Set([
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"PATH",
	"TMPDIR",
	"LANG",
	"LANGUAGE",
	"TZ",
	"SSH_AUTH_SOCK",
	"__CF_USER_TEXT_ENCODING",
	"COMMAND_MODE",
	"DISPLAY",
	"WAYLAND_DISPLAY",
	"DBUS_SESSION_BUS_ADDRESS",
]);

export const SESSION_PREFIXES: readonly string[] = ["LC_", "XDG_"];

function isSessionName(name: string): boolean {
	return SESSION_NAMES.has(name) || SESSION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The part of the service environment a terminal would also have, and the bridge's own names: what the login shell starts from. */
export function sessionEnv(serviceEnv: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [name, value] of Object.entries(serviceEnv)) {
		if (value !== undefined && (isSessionName(name) || isBridgeOwned(name))) env[name] = value;
	}
	return env;
}

export type MergeShellEnvOptions = {
	pathDelimiter?: string;
	/** False in a compiled binary: the bridge's own switches never come from a shell rc file there. */
	bridgeNamesFromShell?: boolean;
};

export type ShellEnvMerge = {
	env: Record<string, string>;
	/** Names whose value came from the shell. */
	imported: number;
	/** Shell names deliberately left out, sorted, for the log line. */
	dropped: string[];
	/** Names the service environment had that neither the session nor the shell gives, sorted, for the log line. */
	left: string[];
};

/**
 * The shell's environment plus the service manager's, resolved name by name:
 *
 * - the shell wins for everything it reported, except `HOME` and, where the service set one, a bridge-owned
 *   name (see `BRIDGE_OWNED_*`);
 * - of the names only the service environment has, the login session's (`SESSION_*`) and the bridge's own
 *   survive; the rest belonged to whatever started the bridge, and are left out (`left`);
 * - `PATH` is the shell's, with any service entry it lacks appended;
 * - shell-run artefacts (`SHELL_NOISE_NAMES`/`SHELL_NOISE_PREFIXES`) are dropped.
 */
export function mergeShellEnv(
	serviceEnv: NodeJS.ProcessEnv,
	shellEnv: Record<string, string>,
	options: MergeShellEnvOptions = {},
): ShellEnvMerge {
	const pathDelimiter = options.pathDelimiter ?? delimiter;
	const bridgeNamesFromShell = options.bridgeNamesFromShell ?? true;
	const env = sessionEnv(serviceEnv);
	const dropped: string[] = [];

	let imported = 0;
	for (const [name, value] of Object.entries(shellEnv)) {
		if (isShellNoise(name)) {
			dropped.push(name);
			continue;
		}
		if (isBridgeOwned(name) && (!bridgeNamesFromShell || serviceEnv[name] !== undefined)) continue;
		env[name] = value;
		imported++;
	}

	const path = mergePath(shellEnv.PATH, serviceEnv.PATH, pathDelimiter);
	if (path !== undefined) env.PATH = path;

	const left = Object.keys(serviceEnv)
		.filter((name) => serviceEnv[name] !== undefined && !(name in env))
		.sort();
	dropped.sort();
	return { env, imported, dropped, left };
}

function mergePath(
	shellPath: string | undefined,
	servicePath: string | undefined,
	pathDelimiter: string,
): string | undefined {
	const entries = (shellPath ?? "").split(pathDelimiter).filter(Boolean);
	const seen = new Set(entries);
	for (const entry of (servicePath ?? "").split(pathDelimiter)) {
		if (!entry || seen.has(entry)) continue;
		seen.add(entry);
		entries.push(entry);
	}
	if (entries.length === 0) return servicePath ?? shellPath;
	return entries.join(pathDelimiter);
}
