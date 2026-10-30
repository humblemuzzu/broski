import "../lib/bench-home";
import { readFile } from "node:fs/promises";
import { createServer, connect as netConnect, type Socket } from "node:net";
import { resolve } from "node:path";
import { mapClaudeCodeSessionToRuntimeSession } from "../../src/runtime/claude-code-runtime-read-models";
import type { ServerMessage } from "../../src/types";
import type { BroskiAssistantTextDeltaEvent, BroskiSessionSummary } from "../../src/types/runtime";
import { type BenchServerHandle, startBenchServer } from "../lib/bench-server";
import { runScenario } from "../lib/report";
import type { ScenarioMetricsInput } from "../lib/types";
import { parseFrame } from "../lib/ws-client";

const STREAM_EVENTS = 20_000;
const SESSION_ROWS = 300;
const SMALL_FRAMES = 200;
const DELTA_CHARS = 120;
const CORPUS_BYTES = STREAM_EVENTS * DELTA_CHARS;

/**
 * Real source text, not `"x".repeat(120)`: a repeated character compresses to nothing and would
 * flatter permessage-deflate by two orders of magnitude.
 */
async function loadCorpus(): Promise<string> {
	const files = ["src/server.ts", "src/types.ts", "src/utils/runtime-send-queue.ts", "bench/run.ts", "README.md"];
	const chunks: string[] = [];
	let total = 0;
	for (const file of files) {
		const text = await readFile(resolve(import.meta.dir, "../..", file), "utf8").catch(() => "");
		if (!text) continue;
		chunks.push(text);
		total += text.length;
		if (total >= CORPUS_BYTES) break;
	}
	const corpus = chunks.join("\n");
	return corpus.length >= CORPUS_BYTES ? corpus.slice(0, CORPUS_BYTES) : corpus.repeat(2).slice(0, CORPUS_BYTES);
}

let corpus = "";
let cursor = 0;

function nextDelta(): string {
	const text = corpus.slice(cursor, cursor + DELTA_CHARS);
	cursor = (cursor + DELTA_CHARS) % Math.max(1, corpus.length);
	return text.padEnd(DELTA_CHARS, " ");
}

type Proxy = { port: number; clientBytes: () => number; stop: () => void };

/** Counting TCP proxy so the numbers are bytes on the wire, after any compression. */
function startProxy(targetPort: number): Promise<Proxy> {
	const peers = new Set<Socket>();
	let closedBytes = 0;
	const server = createServer((peer) => {
		peers.add(peer);
		const upstream = netConnect(targetPort, "127.0.0.1");
		peer.pipe(upstream);
		upstream.pipe(peer);
		peer.on("close", () => {
			closedBytes += peer.bytesWritten;
			peers.delete(peer);
			upstream.end();
		});
		peer.on("error", () => upstream.end());
		upstream.on("close", () => peer.end());
		upstream.on("error", () => peer.end());
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({
				port: (server.address() as { port: number }).port,
				clientBytes: () => {
					let total = closedBytes;
					for (const peer of peers) total += peer.bytesWritten;
					return total;
				},
				stop: () => {
					for (const peer of peers) peer.destroy();
					server.close();
				},
			});
		});
	});
}

function connect(port: number, token: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [`broski-auth.${token}`]);
		const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
		ws.addEventListener("open", () => {
			clearTimeout(timer);
			resolve(ws);
		});
		ws.addEventListener("error", () => {
			clearTimeout(timer);
			reject(new Error("ws connect error"));
		});
	});
}

function buildDelta(): ServerMessage {
	const event: BroskiAssistantTextDeltaEvent = {
		type: "assistant_text_delta",
		backend: "claude-code",
		timestampMs: Date.now(),
		sessionId: "bench-session",
		streamId: "bench-stream",
		delta: nextDelta(),
	};
	return { type: "runtime_event", backend: "claude-code", data: event };
}

function buildSessionList(): ServerMessage {
	const data: BroskiSessionSummary[] = [];
	for (let i = 0; i < SESSION_ROWS; i += 1) {
		data.push(
			mapClaudeCodeSessionToRuntimeSession({
				id: `session-${i}-8f3a21c0-4b6e-4d8f-9a11-2c7d5e9f0b${i}`,
				title: `Refactor the streaming bridge path for session ${i}`,
				cwd: `/Users/someone/StudioProjects/project-${i % 12}`,
				model: "claude-sonnet-4-5-20250929",
				createdAt: 1_700_000_000_000 + i * 1000,
				updatedAt: 1_700_000_000_000 + i * 2000,
				messageCount: 12 + i,
				gitBranch: `feature/stream-${i}`,
				firstPrompt: "Make the bridge stop dropping frames when the phone is on a DERP relay.",
			}),
		);
	}
	return { type: "unified_sessions", backend: "claude-code", data };
}

type Counting = { ws: WebSocket; frames: number; events: number; chars: number; sample: string };

async function connectCounting(proxyPort: number, token: string): Promise<Counting> {
	const counting: Counting = { ws: await connect(proxyPort, token), frames: 0, events: 0, chars: 0, sample: "" };
	counting.ws.addEventListener("message", (event) => {
		counting.frames += 1;
		if (!counting.sample) counting.sample = String(event.data).slice(0, 48);
		const parsed = parseFrame(event.data);
		if (!parsed) return;
		const messages = parsed.type === "batch" ? (parsed.messages as unknown[]) : [parsed];
		for (const raw of messages) {
			if (typeof raw !== "object" || raw === null) continue;
			const message = raw as Record<string, unknown>;
			if (message.type !== "runtime_event") continue;
			const record = message.data as Record<string, unknown>;
			if (record?.type !== "assistant_text_delta") continue;
			counting.events += 1;
			counting.chars += String(record.delta ?? "").length;
		}
	});
	counting.ws.send(JSON.stringify({ type: "set_view", agent: "claude-code", sessionId: "bench-session" }));
	await Bun.sleep(100);
	return counting;
}

async function runStreamPhase(
	handle: BenchServerHandle,
	proxy: Proxy,
	counting: Counting,
	mode: string,
	metrics: ScenarioMetricsInput,
): Promise<void> {
	const cpu = process.cpuUsage();
	const startedAt = Date.now();
	for (let i = 0; i < STREAM_EVENTS; i += 1) handle.server.broadcast(buildDelta());
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline && counting.chars < STREAM_EVENTS * DELTA_CHARS) await Bun.sleep(10);
	const cpuDelta = process.cpuUsage(cpu);
	metrics[`${mode}_streamBytes`] = proxy.clientBytes();
	metrics[`${mode}_streamWallMs`] = Date.now() - startedAt;
	metrics[`${mode}_streamCpuMs`] = Math.round((cpuDelta.user + cpuDelta.system) / 1000);
	metrics[`${mode}_streamChars`] = counting.chars;
	metrics[`${mode}_streamEvents`] = counting.events;
	metrics[`${mode}_streamFrames`] = counting.frames;
	metrics[`${mode}_streamSample`] = counting.sample;
}

async function runPayloadPhases(
	handle: BenchServerHandle,
	proxy: Proxy,
	mode: string,
	metrics: ScenarioMetricsInput,
): Promise<void> {
	const listPayload = buildSessionList();
	const listCpu = process.cpuUsage();
	const beforeList = proxy.clientBytes();
	handle.server.broadcast(listPayload);
	await Bun.sleep(500);
	const listCpuDelta = process.cpuUsage(listCpu);
	metrics[`${mode}_sessionListBytes`] = proxy.clientBytes() - beforeList;
	metrics[`${mode}_sessionListCpuMs`] = Math.round((listCpuDelta.user + listCpuDelta.system) / 1000);
	metrics[`${mode}_sessionListPlainBytes`] = Buffer.byteLength(JSON.stringify(listPayload), "utf8");

	// One delta per frame: what an unbatched, unmerged streaming tick costs. Compression overhead
	// shows up here if anywhere.
	const smallCpu = process.cpuUsage();
	const beforeSmall = proxy.clientBytes();
	for (let i = 0; i < SMALL_FRAMES; i += 1) {
		handle.server.broadcast(buildDelta());
		await Bun.sleep(15);
	}
	await Bun.sleep(300);
	const smallCpuDelta = process.cpuUsage(smallCpu);
	metrics[`${mode}_smallFrameBytes`] = proxy.clientBytes() - beforeSmall;
	metrics[`${mode}_smallFrameCpuMs`] = Math.round((smallCpuDelta.user + smallCpuDelta.system) / 1000);
}

async function measureMode(mode: string, deflate: boolean): Promise<ScenarioMetricsInput> {
	process.env.BROSKI_WS_DEFLATE = deflate ? "1" : "0";
	const handle = await startBenchServer();
	const proxy = await startProxy(handle.port);
	const metrics: ScenarioMetricsInput = { [`${mode}_deflate`]: deflate };

	try {
		const counting = await connectCounting(proxy.port, handle.token);
		metrics[`${mode}_extensions`] = counting.ws.extensions || "(none)";
		await runStreamPhase(handle, proxy, counting, mode, metrics);
		await runPayloadPhases(handle, proxy, mode, metrics);
		counting.ws.close();
	} finally {
		proxy.stop();
		handle.stop();
	}

	return metrics;
}

await runScenario(async () => {
	corpus = await loadCorpus();
	const on = await measureMode("on", true);
	const off = await measureMode("off", false);

	const ratio = (a: unknown, b: unknown): number => {
		const left = typeof a === "number" ? a : 0;
		const right = typeof b === "number" ? b : 0;
		return right === 0 ? 0 : Number((left / right).toFixed(3));
	};

	return {
		...off,
		...on,
		streamBytesRatio: ratio(off.off_streamBytes, on.on_streamBytes),
		sessionListBytesRatio: ratio(off.off_sessionListBytes, on.on_sessionListBytes),
		smallFrameBytesRatio: ratio(off.off_smallFrameBytes, on.on_smallFrameBytes),
		streamCpuRatio: ratio(off.off_streamCpuMs, on.on_streamCpuMs),
	};
});
