/**
 * The wire tap, which the backend starts in place of `agy` (`wire-log.ts` writes the script that runs it): it starts
 * the real `agy` with the same arguments, folder and environment, in the live profile (`profile.ts` `tappedArgs`),
 * passes every line both ways unchanged (stderr included), and appends each line to `<log dir>/<its pid>.jsonl`, with
 * the milliseconds since it started, before it passes the line on: whatever either side has received is in the log. On
 * the live front (`--process-per-session`) a `session/new` or `session/load` and its answer are each logged with the
 * pids of agy's children at that moment, so the worker a session got is what appeared between the two. Once agy
 * answers `initialize`, the tap sends agy its own `authenticate` with the Gemini API key's method, logged as the tap's, and hands the backend agy's `initialize` answer only once agy has
 * accepted it (an answer the backend never sees): the backend itself never authenticates. The tap stops agy, keeping
 * from the backend the answer that made it, when agy refuses the key or any answer of agy's names a plan, so nothing
 * more reaches agy on a Google sign-in. The key, which agy takes from its environment, is written nowhere: each logged
 * line and agy's stderr have it replaced. The tap exits as `agy` did, with its code or by its signal, so the backend
 * sees what it would have seen of `agy` itself.
 *
 *   bun wire-tap.ts <agy> <log dir> <profile dir> [agy's arguments…]
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../adapter-kit/bounded-json";
import { childrenOf } from "./processes";
import {
	API_KEY_METHOD,
	agyProfile,
	CONSUMER_SIGN_IN,
	namesPlan,
	TAP_AUTH_ID,
	tappedArgs,
	withoutApiKey,
} from "./profile";

const [agy, logDir, profileDir, ...args] = process.argv.slice(2);
if (agy === undefined || logDir === undefined || profileDir === undefined) {
	throw new Error("usage: bun wire-tap.ts <agy> <log dir> <profile dir> [args…]");
}

const log = join(logDir, `${process.pid}.jsonl`);
const started = performance.now();
const startedAt = Date.now();
const encoder = new TextEncoder();

function note(record: Record<string, unknown>): void {
	appendFileSync(log, `${withoutApiKey(JSON.stringify({ at: Math.round(performance.now() - started), ...record }))}\n`);
}

/** Calls `line` with each whole line `from` carries, its LF dropped, then with what is left at its end. */
async function lines(from: ReadableStream<Uint8Array>, line: (text: string, last: boolean) => Promise<void>) {
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of from) {
		partial += decoder.decode(chunk, { stream: true });
		const whole = partial.split("\n");
		partial = whole.pop() ?? "";
		for (const text of whole) await line(text, false);
	}
	if (partial !== "") await line(partial, true);
}

function parsed(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

const child = Bun.spawn([agy, ...tappedArgs(args, agyProfile(profileDir))], {
	stdin: "pipe",
	stdout: "pipe",
	stderr: "pipe",
});
note({ start: { pid: child.pid, args, startedAt } });

const toAgent = async (text: string) => {
	child.stdin.write(encoder.encode(text));
	await child.stdin.flush();
};
const toClient = (text: string) =>
	new Promise<void>((done) => {
		process.stdout.write(text, () => done());
	});

const SESSION_OPENS = new Set(["session/new", "session/load"]);
const isFront = args.includes("--process-per-session");
/** The ids of the session opens sent to the front that agy has not answered yet. */
const opening = new Set<unknown>();

function logged(from: "client" | "agent" | "tap", text: string, withChildren = false): void {
	if (text.trim() === "") return;
	note({
		from,
		line: text.replace(/\r$/, ""),
		...(withChildren && { children: childrenOf(child.pid).map(({ pid }) => pid) }),
	});
}

let initializeId: unknown;
/** agy's lines from its `initialize` answer on, held while its `authenticate` is under way. */
let held: string[] | undefined;
let stopped = false;

async function fromClient(text: string, last: boolean): Promise<void> {
	const message = parsed(text);
	if (message?.method === "initialize") initializeId = message.id;
	const opens = isFront && message?.id !== undefined && SESSION_OPENS.has(String(message.method));
	if (opens) opening.add(message?.id);
	logged("client", text, opens);
	await toAgent(last ? text : `${text}\n`);
}

async function fromAgent(text: string, last: boolean): Promise<void> {
	if (stopped) return;
	const message = parsed(text);
	const answer = message !== undefined && message.method === undefined;
	if (answer && namesPlan(message.result)) {
		logged("agent", text);
		return stop(CONSUMER_SIGN_IN);
	}
	if (answer && message.id === TAP_AUTH_ID) {
		logged("agent", text);
		const waiting = held ?? [];
		held = undefined;
		if (message.error !== undefined) return stop(`agy refused the Gemini API key: ${JSON.stringify(message.error)}`);
		for (const line of waiting) await passed(line, false);
		return;
	}
	if (held !== undefined) {
		held.push(text);
		return;
	}
	if (answer && initializeId !== undefined && message.id === initializeId && message.result !== undefined) {
		held = [text];
		const auth = { jsonrpc: "2.0", id: TAP_AUTH_ID, method: "authenticate", params: { methodId: API_KEY_METHOD } };
		const line = JSON.stringify(auth);
		logged("tap", line);
		await toAgent(`${line}\n`);
		return;
	}
	await passed(text, last, message);
}

function stop(why: string): void {
	stopped = true;
	process.stderr.write(withoutApiKey(`the wire tap stopped agy: ${why}\n`));
	child.kill();
}

async function passed(text: string, last: boolean, message = parsed(text)): Promise<void> {
	const opened = message !== undefined && message.method === undefined && opening.delete(message.id);
	logged("agent", text, opened);
	await toClient(last ? text : `${text}\n`);
}

/** A pipe that breaks as `agy` or the backend goes ends that direction; the exit is still `agy`'s. */
void lines(Bun.stdin.stream(), fromClient)
	.then(() => child.stdin.end())
	.catch(() => undefined);
const agentDone = lines(child.stdout, fromAgent).catch(() => undefined);
const stderrDone = lines(child.stderr, async (text, last) => {
	process.stderr.write(withoutApiKey(last ? text : `${text}\n`));
}).catch(() => undefined);
await child.exited;
await Promise.all([agentDone, stderrDone]);
note({ exit: { code: child.exitCode, signal: child.signalCode } });
if (child.signalCode !== null) process.kill(process.pid, child.signalCode);
process.exit(child.exitCode ?? 1);
