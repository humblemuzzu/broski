import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs a script in a child process under a hard clock and memory cap, for the one kind of failure a test
 * in this process cannot survive: an adapter that loops without ever yielding (a parent cycle in a
 * session file). The loop becomes a result, not a hung suite.
 */

export type ProbeResult =
	| { readonly status: "done"; readonly output: string }
	| { readonly status: "timed_out"; readonly afterMs: number; readonly errors: string }
	| { readonly status: "too_big"; readonly rssMb: number; readonly errors: string }
	| { readonly status: "failed"; readonly exitCode: number; readonly errors: string };

export interface ProbeLimits {
	readonly timeoutMs: number;
	readonly maxRssMb: number;
	/** The child's `ulimit -n`, for a probe of what running out of file descriptors does. */
	readonly maxOpenFiles?: number;
}

const DEFAULT_LIMITS: ProbeLimits = { timeoutMs: 20_000, maxRssMb: 1_500 };
const POLL_MS = 100;

/**
 * `argv` is run by the same `bun` as the tests; the child is killed with SIGKILL when it passes a limit. Its temp
 * directory is one this process makes and removes, so what a killed child leaves behind goes with it.
 */
export async function runProbe(argv: readonly string[], limits: ProbeLimits = DEFAULT_LIMITS): Promise<ProbeResult> {
	const temp = mkdtempSync(join(tmpdir(), "broski-pi-probe-"));
	try {
		return await watched(argv, limits, temp);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

async function watched(argv: readonly string[], limits: ProbeLimits, temp: string): Promise<ProbeResult> {
	const env = { ...process.env, TMPDIR: temp };
	const command =
		limits.maxOpenFiles === undefined
			? [process.execPath, ...argv]
			: ["/bin/sh", "-c", `ulimit -n ${limits.maxOpenFiles} && exec "$0" "$@"`, process.execPath, ...argv];
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", env });
	const began = performance.now();
	let verdict: "timed_out" | "too_big" | undefined;
	let seen = { afterMs: 0, rssMb: 0 };
	const watch = setInterval(() => {
		const elapsed = performance.now() - began;
		const rssMb = residentMb(child.pid);
		seen = { afterMs: Math.round(elapsed), rssMb: Math.round(rssMb) };
		if (elapsed > limits.timeoutMs) verdict = "timed_out";
		else if (rssMb > limits.maxRssMb) verdict = "too_big";
		else return;
		child.kill("SIGKILL");
	}, POLL_MS);
	try {
		const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
		const exitCode = await child.exited;
		if (verdict === "timed_out") return { status: verdict, afterMs: seen.afterMs, errors };
		if (verdict === "too_big") return { status: verdict, rssMb: seen.rssMb, errors };
		return exitCode === 0 ? { status: "done", output } : { status: "failed", exitCode, errors };
	} finally {
		clearInterval(watch);
	}
}

function residentMb(pid: number): number {
	const ps = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
	return Number.parseInt(ps.stdout.toString().trim() || "0", 10) / 1024;
}
