import type { Rejected } from "../../contract";
import { rejected } from "../results";

const GIT_TIMEOUT_MS = 45_000;
const MAX_ERROR_CHARS = 5_000;

/**
 * Every pathspec is a literal path (no globs, no `:(magic)`); git never asks for credentials on a terminal it
 * does not have; and reading the status takes none of the optional locks a concurrent git in a terminal needs.
 */
const GIT_PREFIX = ["git", "--literal-pathspecs"];
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

export interface GitRunOptions {
	readonly input?: string;
	/** Past this many bytes of output git is stopped and the output so far is `cut`. */
	readonly maxStdoutBytes?: number;
}

/** What git printed. `cut`: it printed more than `maxStdoutBytes`, and was stopped. */
export interface GitOutput {
	readonly status: "ok";
	readonly stdout: string;
	readonly cut: boolean;
}

interface Exited {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
	readonly cut: boolean;
	readonly timedOut: boolean;
}

/**
 * Runs git in `cwd` and answers what it printed, or a rejection: what git printed on failure (`failure` when it
 * printed nothing), `invalid_input` since git refused what was asked in the state the repository is in.
 */
export async function git(
	args: readonly string[],
	cwd: string,
	failure: string,
	options: GitRunOptions = {},
): Promise<GitOutput | Rejected> {
	let exited: Exited;
	try {
		exited = await run(args, cwd, options);
	} catch (error) {
		return rejected("backend_error", `git could not run: ${String(error)}`);
	}
	if (exited.timedOut) return rejected("backend_error", `git did not finish within ${GIT_TIMEOUT_MS / 1000} s`);
	if (exited.code !== 0 && !exited.cut) {
		const printed = exited.stderr.trim() || exited.stdout.trim() || failure;
		return rejected("invalid_input", printed.slice(0, MAX_ERROR_CHARS));
	}
	return { status: "ok", stdout: exited.stdout, cut: exited.cut };
}

async function run(args: readonly string[], cwd: string, options: GitRunOptions): Promise<Exited> {
	const proc = Bun.spawn([...GIT_PREFIX, ...args], {
		cwd,
		env: { ...process.env, ...GIT_ENV },
		stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, GIT_TIMEOUT_MS);
	try {
		const [out, stderr, code] = await Promise.all([
			readCapped(proc.stdout, options.maxStdoutBytes ?? Number.POSITIVE_INFINITY, () => proc.kill()),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout: out.text, stderr, code, cut: out.cut, timedOut };
	} finally {
		clearTimeout(timer);
	}
}

async function readCapped(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	stop: () => void,
): Promise<{ text: string; cut: boolean }> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let text = "";
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return { text: text + decoder.decode(), cut: false };
		bytes += value.length;
		if (bytes > maxBytes) {
			text += decoder.decode(value.subarray(0, value.length - (bytes - maxBytes)));
			stop();
			await reader.cancel();
			return { text, cut: true };
		}
		text += decoder.decode(value, { stream: true });
	}
}
