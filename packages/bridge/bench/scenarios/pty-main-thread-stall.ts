/**
 * With a PTY session open, an idle terminal used to hold the whole bridge: the reader waited in
 * `poll(fd, 120)` on the JS thread, so every `await` in the process resolved up to 121 ms late per
 * session (measured 605 ms with five). This measures the JS thread itself with three idle sessions
 * and the echo round trip of a live one, because a reader that returns no output would otherwise
 * report a perfectly quiet thread.
 */

import "../lib/bench-home";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isNativePtyAvailable,
	type NativePtyConnection,
	nativeConnectPty,
	nativeCreatePty,
	nativeDeletePty,
	nativeGetPty,
} from "../../src/workspace/pty/native-pty";
import { ensureNativePtyLibrary } from "../lib/pty-helper";
import { runScenario } from "../lib/report";

const IDLE_SESSIONS = Math.max(1, Number(process.env.BENCH_PTY_SESSIONS ?? "3") || 3);
const STALL_SAMPLES = Math.max(10, Number(process.env.BENCH_PTY_STALL_SAMPLES ?? "60") || 60);
const ECHO_SAMPLES = Math.max(5, Number(process.env.BENCH_PTY_ECHO_SAMPLES ?? "15") || 15);
const IDLE_COMMAND = { command: "sleep", args: ["60"] };

function percentile(values: number[], p: number): number {
	if (values.length === 0) return -1;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return Number((sorted[index] ?? -1).toFixed(2));
}

async function measureYieldLatency(samples: number): Promise<number[]> {
	for (let i = 0; i < 5; i++) await Bun.sleep(0);
	const latencies: number[] = [];
	for (let i = 0; i < samples; i++) {
		const start = performance.now();
		await Bun.sleep(0);
		latencies.push(performance.now() - start);
	}
	return latencies;
}

async function openIdle(count: number, ids: string[], connections: NativePtyConnection[]): Promise<void> {
	for (let i = 0; i < count; i++) {
		const session = await nativeCreatePty(IDLE_COMMAND);
		if (!session) throw new Error("could not create a native PTY session");
		ids.push(session.id);
		const connection = nativeConnectPty(session.id);
		if (!connection) throw new Error("could not connect to a native PTY session");
		connections.push(connection);
	}
}

async function measureEchoLatency(): Promise<number[]> {
	const dir = await mkdtemp(join(tmpdir(), "broski-bench-pty-"));
	const script = join(dir, "echo.sh");
	await writeFile(script, 'while IFS= read -r line; do printf "ACK:%s\\n" "$line"; done\n', { mode: 0o755 });

	const session = await nativeCreatePty({ command: script });
	if (!session) throw new Error("could not create the echo PTY session");
	const connection = nativeConnectPty(session.id);
	if (!connection) throw new Error("could not connect to the echo PTY session");

	const pending = new Map<string, number>();
	const latencies: number[] = [];
	connection.onData((data) => {
		for (const line of data.split("\n")) {
			const match = /^ACK:ping-(\d+)/.exec(line.trim());
			if (!match?.[1]) continue;
			const sentAt = pending.get(match[1]);
			if (sentAt === undefined) continue;
			pending.delete(match[1]);
			latencies.push(performance.now() - sentAt);
		}
	});

	try {
		await Bun.sleep(300);
		for (let i = 0; i < ECHO_SAMPLES; i++) {
			const key = String(i);
			pending.set(key, performance.now());
			connection.write(`ping-${key}\n`);
			const deadline = Date.now() + 2000;
			while (pending.has(key) && Date.now() < deadline) await Bun.sleep(1);
			pending.delete(key);
			await Bun.sleep(10);
		}
		return latencies;
	} finally {
		connection.disconnect();
		await nativeDeletePty(session.id).catch(() => {});
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

await runScenario(async () => {
	const helper = ensureNativePtyLibrary();
	if (!isNativePtyAvailable()) throw new Error("native PTY helper is not available");

	const ids: string[] = [];
	const connections: NativePtyConnection[] = [];

	try {
		await openIdle(IDLE_SESSIONS, ids, connections);
		const latencies = await measureYieldLatency(STALL_SAMPLES);
		const running = await Promise.all(ids.map((id) => nativeGetPty(id)));
		const runningCount = running.filter((session) => session?.status === "running").length;
		const echoLatencies = await measureEchoLatency();

		return {
			helper,
			idleSessions: IDLE_SESSIONS,
			idleSessionsRunning: runningCount,
			yieldSamples: latencies.length,
			idleStallP50Ms: percentile(latencies, 50),
			idleStallP99Ms: percentile(latencies, 99),
			idleStallMaxMs: Number(Math.max(...latencies).toFixed(2)),
			echoSamples: echoLatencies.length,
			echoP50Ms: percentile(echoLatencies, 50),
			echoMaxMs: Number((Math.max(...echoLatencies, 0) || -1).toFixed(2)),
		};
	} finally {
		for (const connection of connections) connection.disconnect();
		for (const id of ids) await nativeDeletePty(id).catch(() => {});
	}
});
