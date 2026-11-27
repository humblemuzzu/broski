/** The version of an agent's executable, from `<path> --version`, read again only when the executable changes. */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { errorText } from "./error-text";

const VERSION_TIMEOUT_MS = 10_000;

export type CliVersionRead = { readonly version: string } | { readonly problem: string };

export class CliVersion {
	private known: { readonly stamp: string; readonly version: Promise<CliVersionRead> } | undefined;

	constructor(
		private readonly path: string,
		private readonly env: Readonly<Record<string, string>>,
	) {}

	async read(): Promise<CliVersionRead> {
		const stamp = await executableStamp(this.path);
		if (this.known?.stamp !== stamp) this.known = { stamp, version: readCliVersion(this.path, this.env) };
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

/** The first `x.y.z` that `<path> --version` prints; `env` is the process's own when not given. */
export function readCliVersion(path: string, env?: Readonly<Record<string, string>>): Promise<CliVersionRead> {
	return new Promise((resolve) => {
		const options = { timeout: VERSION_TIMEOUT_MS, ...(env !== undefined && { env: { ...env } }) };
		execFile(path, ["--version"], options, (error, stdout) => {
			const version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
			if (version !== undefined) resolve({ version });
			else resolve({ problem: `\`${path} --version\` did not print a version${error ? `: ${errorText(error)}` : ""}` });
		});
	});
}

/** What changes when the file at `path` is replaced or rewritten: an update of the executable. */
export async function executableStamp(path: string): Promise<string> {
	try {
		const stats = await stat(path);
		return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
	} catch {
		return "-";
	}
}
