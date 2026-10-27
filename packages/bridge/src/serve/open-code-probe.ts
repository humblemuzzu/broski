/**
 * Says why a managed OpenCode server did not start.
 *
 * The SDK launches `opencode serve` and waits for a stdout line that starts with `opencode server
 * listening`; when that never comes it reports only "Timeout waiting for server to start", which fits a
 * missing binary, a crash and a different OpenCode release alike. The probe runs the same binary once more
 * and reports what it is and what it printed.
 */

import { spawn } from "node:child_process";

/** The first words of the line the SDK waits for before it hands out a server URL. */
export const SDK_LISTENING_PREFIX = "opencode server listening";

const VERSION_TIMEOUT_MS = 3000;
const BANNER_TIMEOUT_MS = 4000;
const REPORTED_LINE_CHARS = 160;
/** After its first line, a process that is about to exit gets this long to do so before it counts as running. */
const EXIT_GRACE_MS = 200;

export type OpenCodeProbe = {
	/** Where `opencode` resolved on PATH, or null when it is not on it. */
	binary: string | null;
	version: string | null;
	/** The first stdout/stderr line `opencode serve` printed, cut for the log. */
	firstLine: string | null;
	/** `serve` printed a listening banner, but not the one the SDK waits for. */
	foreignBanner: boolean;
	exitCode: number | null;
};

type Captured = { text: string; exitCode: number | null };

function capture(binary: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Captured> {
	return new Promise((resolve) => {
		let text = "";
		let settled = false;
		const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"] });
		const finish = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill("SIGKILL");
			resolve({ text, exitCode });
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		let graceStarted = false;
		const collect = (chunk: Buffer): void => {
			text += chunk.toString();
			if (!text.includes("\n") || graceStarted) return;
			graceStarted = true;
			setTimeout(() => finish(null), EXIT_GRACE_MS);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
		child.on("error", () => finish(null));
		child.on("exit", (code) => finish(code));
	});
}

function firstLineOf(text: string): string | null {
	const line = text.split("\n").find((candidate) => candidate.trim().length > 0);
	return line ? line.trim().slice(0, REPORTED_LINE_CHARS) : null;
}

export async function probeOpenCode(env: NodeJS.ProcessEnv = process.env): Promise<OpenCodeProbe> {
	const binary = Bun.which("opencode", { PATH: env.PATH ?? "" });
	if (!binary) return { binary: null, version: null, firstLine: null, foreignBanner: false, exitCode: null };

	const version = firstLineOf((await capture(binary, ["--version"], env, VERSION_TIMEOUT_MS)).text);
	const banner = await capture(binary, ["serve", "--hostname=127.0.0.1", "--port=0"], env, BANNER_TIMEOUT_MS);
	const firstLine = firstLineOf(banner.text);
	const listens = firstLine !== null && /server listening on https?:\/\//.test(firstLine);
	return {
		binary,
		version,
		firstLine,
		foreignBanner: listens && !firstLine.startsWith(SDK_LISTENING_PREFIX),
		exitCode: banner.exitCode,
	};
}

export function describeOpenCodeProbe(probe: OpenCodeProbe): string {
	if (!probe.binary) return "`opencode` is not on the bridge's PATH";
	const identity = `${probe.binary}${probe.version ? ` (${probe.version})` : ""}`;
	if (probe.foreignBanner) {
		return `${identity} starts, but prints "${probe.firstLine}" where this bridge's OpenCode SDK waits for "${SDK_LISTENING_PREFIX} on …": that OpenCode release is not supported by this bridge`;
	}
	if (probe.exitCode !== null) {
		return `${identity} exited with code ${probe.exitCode}${probe.firstLine ? ` after printing "${probe.firstLine}"` : ""}`;
	}
	return `${identity} printed ${probe.firstLine ? `"${probe.firstLine}"` : "nothing"} within ${BANNER_TIMEOUT_MS / 1000}s of \`serve\``;
}
