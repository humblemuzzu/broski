/**
 * The wire tap, which the backend starts in place of `agy` (`wire-log.ts` writes the script that runs it): it starts
 * the real `agy` with the same arguments, folder and environment, passes every byte both ways unchanged (stderr
 * included), and appends each line it passed to `<log dir>/<its pid>.jsonl` with the milliseconds since it started.
 * It exits as `agy` did, with its code or by its signal, so the backend sees what it would have seen of `agy` itself.
 *
 *   bun wire-tap.ts <agy> <log dir> [agy's arguments…]
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";

const [agy, logDir, ...args] = process.argv.slice(2);
if (agy === undefined || logDir === undefined) throw new Error("usage: bun wire-tap.ts <agy> <log dir> [args…]");

const log = join(logDir, `${process.pid}.jsonl`);
const started = performance.now();

function note(record: Record<string, unknown>): void {
	appendFileSync(log, `${JSON.stringify({ at: Math.round(performance.now() - started), ...record })}\n`);
}

/** Copies `from` through `write`, noting each whole line it carried as `side`'s. */
async function pump(
	from: ReadableStream<Uint8Array>,
	write: (chunk: Uint8Array) => Promise<void>,
	side: "client" | "agent",
): Promise<void> {
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of from) {
		await write(chunk);
		partial += decoder.decode(chunk, { stream: true });
		const lines = partial.split("\n");
		partial = lines.pop() ?? "";
		for (const line of lines) if (line.trim() !== "") note({ from: side, line: line.replace(/\r$/, "") });
	}
	if (partial.trim() !== "") note({ from: side, line: partial });
}

const child = Bun.spawn([agy, ...args], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
note({ start: { pid: child.pid, args, startedAt: Date.now() } });

const toAgent = async (chunk: Uint8Array) => {
	child.stdin.write(chunk);
	await child.stdin.flush();
};
const toClient = (chunk: Uint8Array) =>
	new Promise<void>((done) => {
		process.stdout.write(chunk, () => done());
	});

/** A pipe that breaks as `agy` or the backend goes ends that direction; the exit is still `agy`'s. */
void pump(Bun.stdin.stream(), toAgent, "client")
	.then(() => child.stdin.end())
	.catch(() => undefined);
const agentDone = pump(child.stdout, toClient, "agent").catch(() => undefined);
await child.exited;
await agentDone;
note({ exit: { code: child.exitCode, signal: child.signalCode } });
if (child.signalCode !== null) process.kill(process.pid, child.signalCode);
process.exit(child.exitCode ?? 1);
