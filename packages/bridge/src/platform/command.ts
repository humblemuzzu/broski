import { type SpawnSyncReturns, spawnSync } from "node:child_process";

export const COMMAND_TIMEOUT_MS = 5000;

export interface RunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	status: number | null;
}

export interface RunOptions {
	timeout?: number;
	input?: string;
	shell?: boolean;
}

/**
 * Injected so service code can be tested without running anything.
 */
export type CommandRunner = (cmd: string, args: string[], opts?: RunOptions) => RunResult;

/**
 * Run a shell command with timeout and error handling.
 * Returns a RunResult; never throws.
 */
export const runCommand: CommandRunner = (cmd, args, opts) => {
	try {
		const result: SpawnSyncReturns<string> = spawnSync(cmd, args, {
			encoding: "utf-8",
			timeout: opts?.timeout ?? COMMAND_TIMEOUT_MS,
			stdio: ["pipe", "pipe", "pipe"],
			input: opts?.input,
			shell: opts?.shell ?? false,
		});
		return {
			ok: result.status === 0,
			stdout: (result.stdout ?? "").trim(),
			stderr: (result.stderr ?? "").trim(),
			status: result.status,
		};
	} catch {
		return { ok: false, stdout: "", stderr: "", status: null };
	}
};

export function describeFailure(res: RunResult): string {
	if (res.stderr) return res.stderr;
	if (res.stdout) return res.stdout;
	return res.status === null ? "command not found" : `exit code ${res.status}`;
}
