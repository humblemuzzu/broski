/**
 * The version of the user's `pi`, from `pi --version`, read again only when the executable changes, and how it
 * compares with the oldest version the adapter relies on.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { errorText } from "./error-text";

/**
 * 1.5.1 made a shutdown that stdin's end began survive the SIGTERM that follows it (pi-coding-agent 1.5.2
 * `CHANGELOG.md:69`), which the adapter's shutdown relies on (`rpc/child.ts`); the RPC features it uses are older:
 * prompt dispositions 0.99.0 (`:698`), `agent_settled.aborted` 1.1.0 (`:434`).
 */
export const MIN_PI_VERSION = "1.5.1";

const VERSION_TIMEOUT_MS = 10_000;

export type PiVersion = { readonly version: string } | { readonly problem: string };

export class CliVersion {
	private known: { readonly stamp: string; readonly version: Promise<PiVersion> } | undefined;

	constructor(
		private readonly path: string,
		private readonly env: Readonly<Record<string, string>>,
	) {}

	async read(): Promise<PiVersion> {
		const stamp = await stampOf(this.path);
		if (this.known?.stamp !== stamp) this.known = { stamp, version: readPiVersion(this.path, this.env) };
		return this.known.version;
	}
}

/** `-1`, `0` or `1` as `a` is below, equal to or above `b`; parts a version lacks count as 0. */
export function compareVersions(a: string, b: string): number {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	for (let at = 0; at < Math.max(left.length, right.length); at++) {
		const difference = (left[at] ?? 0) - (right[at] ?? 0);
		if (difference !== 0) return Math.sign(difference);
	}
	return 0;
}

/** `pi --version` of that file, which prints and exits before it reads any configuration; `env` is the process's own when not given. */
export function readPiVersion(path: string, env?: Readonly<Record<string, string>>): Promise<PiVersion> {
	return new Promise((resolve) => {
		const options = { timeout: VERSION_TIMEOUT_MS, ...(env !== undefined && { env: { ...env } }) };
		execFile(path, ["--version"], options, (error, stdout) => {
			const version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
			if (version !== undefined) resolve({ version });
			else resolve({ problem: `\`${path} --version\` did not print a version${error ? `: ${errorText(error)}` : ""}` });
		});
	});
}

async function stampOf(path: string): Promise<string> {
	try {
		const stats = await stat(path);
		return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
	} catch {
		return "-";
	}
}
