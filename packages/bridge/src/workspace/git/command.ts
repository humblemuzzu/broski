import type { CommandResult, GitResult } from "./types";

const GIT_TIMEOUT_MS = 45_000;
const MAX_ERROR_CHARS = 5000;

export async function runGit(args: string[], cwd: string): Promise<CommandResult> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });

	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		try {
			proc.kill();
		} catch {
			// already exited
		}
	}, GIT_TIMEOUT_MS);

	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode, timedOut };
	} finally {
		clearTimeout(timeout);
	}
}

/** Runs git and answers its stdout, or what it printed on failure (`failure` when it printed nothing). */
export async function git(args: string[], cwd: string, failure: string): Promise<GitResult<string>> {
	const result = await runGit(args, cwd);
	if (result.timedOut) return { ok: false, error: "Command timed out" };
	if (result.exitCode !== 0) {
		const error = result.stderr.trim() || result.stdout.trim() || failure;
		return { ok: false, error: error.slice(0, MAX_ERROR_CHARS) };
	}
	return { ok: true, value: result.stdout };
}

export function refused<T>(error: string): GitResult<T> {
	return { ok: false, error };
}
