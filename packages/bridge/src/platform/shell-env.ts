/**
 * Importing the user's login-shell environment, once, when the bridge runs as a service.
 *
 * launchd and systemd start `broski-link` with a near-empty environment (the plist sets only PATH and
 * HOME), so what the user exports in `~/.zshrc` — provider API keys, `~/.local/bin`, version manager
 * shims — is missing from the bridge and every agent it runs, while the same agents work in the user's
 * terminal. This asks the login shell for its environment and replaces `process.env` before any
 * connector or PTY exists.
 *
 * A `~/.zshrc` change applies on the next bridge start: `broski restart`, or the app's restart button
 * (`bridge_restart`, which the link daemon answers by replacing the bridge process).
 */

import { isCompiledBinary } from "../compiled-binary";
import { isInsideRealHome, isIsolationActive } from "../safety/real-home-guard";
import { mergeShellEnv } from "./shell-env-parse";
import { resolveUserShellEnv, type ShellEnvOptions, type ShellEnvResult } from "./shell-env-resolve";

export type { ShellEnvOptions, ShellEnvResult } from "./shell-env-resolve";
export { resolveShellBinary, resolveUserShellEnv, SHELL_ENV_TIMEOUT_MS } from "./shell-env-resolve";

/** The two ways a bridge starts without a terminal: the daemon's flags, or no TTY at all. */
export type ServiceStartHint = {
	daemon?: boolean;
	linkSocket?: string;
	isTty?: boolean;
};

export function isServiceStart(hint: ServiceStartHint): boolean {
	if (process.platform === "win32") return false;
	if (hint.daemon === true || hint.linkSocket !== undefined) return true;
	return hint.isTty === false;
}

/**
 * True when this run is test-isolated and its HOME is the developer's real one, where resolving would
 * read the live `~/.zshrc`.
 */
export function resolvesRealHome(env: NodeJS.ProcessEnv = process.env): boolean {
	const home = env.HOME;
	return isIsolationActive() && (home === undefined || isInsideRealHome(home));
}

export type ShellEnvLog = {
	info(message: string): void;
	warn(message: string): void;
};

export type ApplyShellEnvOptions = ShellEnvOptions & {
	daemon?: boolean;
	linkSocket?: string;
	isTty?: boolean;
	/** Object to write the merged environment into. Defaults to `process.env`. */
	target?: NodeJS.ProcessEnv;
};

function replaceEnv(target: NodeJS.ProcessEnv, next: Record<string, string>): void {
	for (const name of Object.keys(target)) {
		if (!(name in next)) delete target[name];
	}
	for (const [name, value] of Object.entries(next)) target[name] = value;
}

/**
 * Imports the login-shell environment into `process.env` when this bridge runs as a service. Failure
 * is one warning naming the reason (never a value) and the service environment stands. Returns `null`
 * when the import was skipped as unnecessary, or unsafe under test isolation.
 */
export async function applyServiceShellEnv(
	log: ShellEnvLog,
	options: ApplyShellEnvOptions = {},
): Promise<ShellEnvResult | null> {
	const target = options.target ?? process.env;
	const hint: ServiceStartHint = {
		daemon: options.daemon,
		linkSocket: options.linkSocket,
		isTty: options.isTty ?? Boolean(process.stdout.isTTY),
	};
	if (!isServiceStart(hint)) return null;

	if (resolvesRealHome(target)) {
		log.info("[shell-env] skipped: this run is isolated to a temporary home");
		return null;
	}

	const started = Date.now();
	const resolved = await resolveUserShellEnv({
		shell: options.shell,
		timeoutMs: options.timeoutMs,
		maxBytes: options.maxBytes,
		env: target,
	});
	if (!resolved.ok) {
		log.warn(`[shell-env] continuing with the service environment (${resolved.reason})`);
		return resolved;
	}

	const merged = mergeShellEnv(target, resolved.env, { bridgeNamesFromShell: !isCompiledBinary() });
	replaceEnv(target, merged.env);
	log.info(
		`[shell-env] imported ${merged.imported} variables from ${resolved.shell} in ${Date.now() - started}ms, ` +
			`left ${merged.dropped.length} shell-only names behind`,
	);
	return resolved;
}
