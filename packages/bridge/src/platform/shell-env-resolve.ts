/**
 * Asking the user's login shell for its environment.
 *
 * One interactive login shell, `env -0` between two markers so rc-file banners cannot corrupt the
 * parse, a hard timeout that kills the shell's whole process group, and a bound on how much it may
 * print. Nothing here touches `process.env`: `shell-env.ts` decides whether to import the result.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { userInfo } from "node:os";
import {
	isRefusingShell,
	newMarker,
	parseMarkedEnv,
	SHELL_ENV_FLAG,
	shellArgs,
	shellCommand,
	shellDialect,
} from "./shell-env-parse";

export const SHELL_ENV_TIMEOUT_MS = 10_000;
export const MAX_SHELL_ENV_BYTES = 1 << 20;

/** A terminal's TERM, so rc files that gate on it still run their PATH and key exports. */
const RESOLVE_TERM = "xterm-256color";

export type ShellEnvResult =
	| { ok: true; shell: string; env: Record<string, string>; durationMs: number; bytes: number }
	| { ok: false; shell: string | null; reason: string; durationMs: number };

export type ShellEnvOptions = {
	/** Shell to ask, overriding detection. */
	shell?: string;
	timeoutMs?: number;
	maxBytes?: number;
	/** Environment the shell starts from. */
	env?: NodeJS.ProcessEnv;
};

type ShellChoice = { ok: true; shell: string } | { ok: false; reason: string };
type ShellRun = { ok: true; raw: string; bytes: number } | { ok: false; reason: string };

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function passwdShell(): string | undefined {
	try {
		return userInfo().shell ?? undefined;
	} catch {
		return undefined;
	}
}

/** Explicit override, then the passwd entry, then `$SHELL`, then the platform's login shell. */
export function resolveShellBinary(options: { shell?: string; env?: NodeJS.ProcessEnv } = {}): ShellChoice {
	const env = options.env ?? process.env;
	const requested = options.shell?.trim();
	if (requested) {
		const unsupported = isUnsupported(requested);
		if (unsupported !== null) return { ok: false, reason: unsupported };
		return { ok: true, shell: requested };
	}

	const fallback = process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
	const candidates = [passwdShell(), env.SHELL, fallback];
	const seen = new Set<string>();

	let existing: string | null = null;
	for (const candidate of candidates) {
		const path = candidate?.trim();
		if (!path || seen.has(path)) continue;
		seen.add(path);
		if (!isExecutable(path) || isRefusingShell(path)) continue;
		existing ??= path;
		if (shellDialect(path) !== null) return { ok: true, shell: path };
	}

	if (existing) return { ok: false, reason: `${existing} is not a supported login shell` };
	return { ok: false, reason: "no login shell found" };
}

function isUnsupported(path: string): string | null {
	if (!isExecutable(path)) return `${path} is not an executable shell`;
	if (isRefusingShell(path)) return `${path} refuses a login`;
	if (shellDialect(path) === null) return `${path} is not a supported login shell`;
	return null;
}

function killGroup(child: ChildProcess): void {
	const pid = child.pid;
	try {
		if (pid === undefined) child.kill("SIGKILL");
		else process.kill(-pid, "SIGKILL");
	} catch {
		try {
			child.kill("SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

/** `detached` gives the shell its own process group, so a timeout also kills what its rc files started. */
function runShell(shell: string, marker: string, options: ShellEnvOptions): Promise<ShellRun> {
	const timeoutMs = options.timeoutMs ?? SHELL_ENV_TIMEOUT_MS;
	const maxBytes = options.maxBytes ?? MAX_SHELL_ENV_BYTES;

	const child = spawn(shell, shellArgs(shell, shellCommand(marker)), {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...(options.env ?? process.env), [SHELL_ENV_FLAG]: "1", TERM: RESOLVE_TERM } as NodeJS.ProcessEnv,
	});

	return new Promise<ShellRun>((resolvePromise) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		let timedOut = false;

		const finish = (result: ShellRun): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolvePromise(result);
		};

		const timer = setTimeout(() => {
			timedOut = true;
			killGroup(child);
		}, timeoutMs);

		child.stdout?.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > maxBytes) {
				killGroup(child);
				finish({ ok: false, reason: `the shell printed more than ${maxBytes} bytes` });
				return;
			}
			chunks.push(chunk);
		});
		child.stderr?.on("data", () => {
			// An rc file's chatter, never parsed.
		});
		child.on("error", (error) => finish({ ok: false, reason: `could not start ${shell}: ${error.message}` }));
		child.on("close", () => {
			if (timedOut) finish({ ok: false, reason: `${shell} did not finish within ${timeoutMs}ms` });
			else finish({ ok: true, raw: Buffer.concat(chunks).toString("utf8"), bytes });
		});
	});
}

/** What the user's login shell reports for the environment it starts from. */
export async function resolveUserShellEnv(options: ShellEnvOptions = {}): Promise<ShellEnvResult> {
	const started = Date.now();
	const choice = resolveShellBinary({ shell: options.shell, env: options.env });
	if (!choice.ok) return { ok: false, shell: null, reason: choice.reason, durationMs: Date.now() - started };

	const marker = newMarker();
	const run = await runShell(choice.shell, marker, options);
	const durationMs = Date.now() - started;
	if (!run.ok) return { ok: false, shell: choice.shell, reason: run.reason, durationMs };

	const parsed = parseMarkedEnv(run.raw, marker);
	if (!parsed.ok) return { ok: false, shell: choice.shell, reason: parsed.reason, durationMs };
	return { ok: true, shell: choice.shell, env: parsed.env, durationMs, bytes: run.bytes };
}
