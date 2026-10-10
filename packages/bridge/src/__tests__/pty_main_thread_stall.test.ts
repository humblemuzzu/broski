/**
 * A PTY session used to be read with a blocking `poll(fd, 120)` on the JS thread, which delayed
 * every other await in the bridge by up to the timeout — 121 ms per idle session, 605 ms with five
 * open. These run an idle child and measure the JS thread itself, so they fail on that shape and
 * pass on any reader that leaves the waiting to the runtime.
 */

import { afterAll, describe, expect, test } from "bun:test";
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
} from "../pty/native-pty";

const STALL_SAMPLES = 50;
const WRITE_STALL_BYTES = 4 * 1024 * 1024;
const STALL_P99_BUDGET_MS = 5;
const STALL_P99_BUDGET_THREE_SESSIONS_MS = 10;
const ECHO_P50_BUDGET_MS = 16;
const ECHO_SAMPLES = 20;
const PTY_TEST_TIMEOUT_MS = 25_000;
const IDLE_COMMAND = { command: "sleep", args: ["30"] };

const createdIds: string[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
	for (const id of createdIds) await nativeDeletePty(id).catch(() => {});
	for (const dir of tempDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function makeChildScript(body: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-pty-stall-"));
	tempDirs.push(dir);
	const path = join(dir, "child.sh");
	await writeFile(path, body, { mode: 0o755 });
	return path;
}

function percentile(samples: number[], fraction: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
	return sorted[index] ?? 0;
}

function round(ms: number): number {
	return Number(ms.toFixed(2));
}

async function openIdleSessions(count: number): Promise<NativePtyConnection[]> {
	const connections: NativePtyConnection[] = [];
	for (let i = 0; i < count; i++) {
		const session = await nativeCreatePty(IDLE_COMMAND);
		expect(session).toBeTruthy();
		if (!session) continue;
		createdIds.push(session.id);
		const connection = nativeConnectPty(session.id);
		expect(connection).toBeTruthy();
		if (connection) connections.push(connection);
	}
	return connections;
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

async function assertStillRunning(ids: string[]): Promise<void> {
	for (const id of ids) {
		const session = await nativeGetPty(id);
		expect(session?.status).toBe("running");
	}
}

describe("native PTY reader does not block the JS thread", () => {
	test(
		"an idle session leaves the event loop alone",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const connections = await openIdleSessions(1);
			try {
				expect(connections.length).toBe(1);
				const latencies = await measureYieldLatency(STALL_SAMPLES);
				const p99 = percentile(latencies, 0.99);
				console.log(`[pty] 1 idle session yield p99 ${round(p99)} ms (max ${round(Math.max(...latencies))})`);
				await assertStillRunning(createdIds);
				expect(p99).toBeLessThan(STALL_P99_BUDGET_MS);
			} finally {
				for (const connection of connections) connection.disconnect();
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);

	test(
		"three idle sessions leave the event loop alone",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const connections = await openIdleSessions(3);
			try {
				expect(connections.length).toBe(3);
				const latencies = await measureYieldLatency(STALL_SAMPLES);
				const p99 = percentile(latencies, 0.99);
				console.log(`[pty] 3 idle sessions yield p99 ${round(p99)} ms (max ${round(Math.max(...latencies))})`);
				await assertStillRunning(createdIds);
				expect(p99).toBeLessThan(STALL_P99_BUDGET_THREE_SESSIONS_MS);
			} finally {
				for (const connection of connections) connection.disconnect();
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);

	test(
		"a large write does not hold the JS thread",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const script = await makeChildScript("cat > /dev/null\n");
			const session = await nativeCreatePty({ command: script });
			expect(session).toBeTruthy();
			if (!session) return;
			createdIds.push(session.id);

			const connection = nativeConnectPty(session.id);
			expect(connection).toBeTruthy();
			if (!connection) return;

			try {
				await Bun.sleep(200);
				connection.write("a".repeat(WRITE_STALL_BYTES));
				const latencies = await measureYieldLatency(STALL_SAMPLES);
				const p99 = percentile(latencies, 0.99);
				console.log(`[pty] yield during a 4 MiB write p99 ${round(p99)} ms (max ${round(Math.max(...latencies))})`);
				expect(p99).toBeLessThan(STALL_P99_BUDGET_MS);
			} finally {
				connection.disconnect();
				await nativeDeletePty(session.id);
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);

	test(
		"child output reaches the callback quickly",
		async () => {
			if (!isNativePtyAvailable()) {
				expect(isNativePtyAvailable()).toBe(false);
				return;
			}

			const script = await makeChildScript('while IFS= read -r line; do printf "ACK:%s\\n" "$line"; done\n');
			const session = await nativeCreatePty({ command: script });
			expect(session).toBeTruthy();
			if (!session) return;
			createdIds.push(session.id);

			const connection = nativeConnectPty(session.id);
			expect(connection).toBeTruthy();
			if (!connection) return;

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
					expect(pending.has(key)).toBe(false);
					await Bun.sleep(10);
				}

				expect(latencies.length).toBe(ECHO_SAMPLES);
				const p50 = percentile(latencies, 0.5);
				console.log(`[pty] echo round trip p50 ${round(p50)} ms (max ${round(Math.max(...latencies))})`);
				expect(p50).toBeLessThan(ECHO_P50_BUDGET_MS);
			} finally {
				connection.disconnect();
				await nativeDeletePty(session.id);
			}
		},
		PTY_TEST_TIMEOUT_MS,
	);
});
