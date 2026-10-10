import "../lib/bench-home";
import type { ServerMessage } from "../../src/types";
import type { BroskiAssistantTextDeltaEvent } from "../../src/types/runtime";
import { type BenchServerHandle, startBenchServer } from "../lib/bench-server";
import { runScenario } from "../lib/report";
import type { ScenarioMetrics } from "../lib/types";
import { connectBenchClient, parseFrame, watchSession } from "../lib/ws-client";

const EVENTS = 20_000;
const CLIENT_COUNTS = [1, 4];
const DRAIN_TIMEOUT_MS = 20_000;
const DELTA_CHARS = 120;
const DELTA = "x".repeat(DELTA_CHARS);

type ClientStats = {
	frames: number;
	wireBytes: number;
	received: number;
	chars: number;
	mergedFrames: number;
	latencies: number[];
};

type Phase = {
	wallMs: number;
	drainMs: number;
	cpuMs: number;
	eventsMin: number;
	eventsMax: number;
	charsMin: number;
	mergedFramesMin: number;
	framesMin: number;
	framesMax: number;
	wireBytesMin: number;
	wireBytesMax: number;
	wireBytesAvg: number;
	charsPerEventMin: number;
	eventsPerSec: number;
	p50Ms: number;
	p99Ms: number;
};

function frameHeaderBytes(payloadBytes: number): number {
	if (payloadBytes < 126) return 2;
	if (payloadBytes < 65_536) return 4;
	return 10;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return -1;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index] ?? -1;
}

function buildEvent(): ServerMessage {
	const event: BroskiAssistantTextDeltaEvent = {
		type: "assistant_text_delta",
		backend: "pi",
		timestampMs: Date.now(),
		sessionId: "bench-session",
		streamId: "bench-stream",
		delta: DELTA,
	};
	return { type: "runtime_event", backend: "pi", data: event };
}

/** One received frame is either a message or a `batch` envelope holding several. */
function framesOf(parsed: Record<string, unknown> | null): Array<Record<string, unknown>> {
	if (!parsed) return [];
	if (parsed.type !== "batch") return [parsed];
	const messages = parsed.messages;
	if (!Array.isArray(messages)) return [];
	return messages.filter(
		(message): message is Record<string, unknown> =>
			typeof message === "object" && message !== null && !Array.isArray(message),
	);
}

async function runPhase(handle: BenchServerHandle, clientCount: number): Promise<Phase> {
	const stats: ClientStats[] = [];
	const sockets: WebSocket[] = [];

	for (let i = 0; i < clientCount; i += 1) {
		const ws = await connectBenchClient(handle.port, handle.token);
		watchSession(ws, "pi", "bench-session");
		const stat: ClientStats = {
			frames: 0,
			wireBytes: 0,
			received: 0,
			chars: 0,
			mergedFrames: 0,
			latencies: [],
		};
		ws.addEventListener("message", (event) => {
			stat.frames += 1;
			const payload = typeof event.data === "string" ? event.data : "";
			if (payload) stat.wireBytes += Buffer.byteLength(payload, "utf8") + frameHeaderBytes(payload.length);
			const parsed = parseFrame(event.data);
			for (const message of framesOf(parsed)) {
				if (message.type !== "runtime_event") continue;
				const data = message.data;
				if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
				const record = data as Record<string, unknown>;
				if (record.type !== "assistant_text_delta") continue;
				stat.received += 1;
				if (typeof record.delta === "string") {
					stat.chars += record.delta.length;
					if (record.delta.length > DELTA_CHARS) stat.mergedFrames += 1;
				}
				if (typeof record.timestampMs === "number") stat.latencies.push(Date.now() - record.timestampMs);
			}
		});
		sockets.push(ws);
		stats.push(stat);
	}

	const cpuStart = process.cpuUsage();
	// Let the bridge process the set_view frames first: a socket is only sent a session's
	// deltas once it is viewing that session.
	await Bun.sleep(50);
	const startedAt = Date.now();
	for (let i = 0; i < EVENTS; i += 1) {
		handle.server.broadcast(buildEvent());
	}
	const sentDoneAt = Date.now();

	const deadline = sentDoneAt + DRAIN_TIMEOUT_MS;
	while (Date.now() < deadline && !stats.every((stat) => stat.chars >= EVENTS * DELTA_CHARS)) {
		await Bun.sleep(25);
	}
	const drainMs = Date.now() - sentDoneAt;
	const wallMs = Date.now() - startedAt;
	const cpuDelta = process.cpuUsage(cpuStart);

	for (const ws of sockets) ws.close();

	const latencies: number[] = [];
	for (const stat of stats) latencies.push(...stat.latencies);
	latencies.sort((a, b) => a - b);

	const events = stats.map((stat) => stat.received);
	const chars = stats.map((stat) => stat.chars);
	const merged = stats.map((stat) => stat.mergedFrames);
	const frames = stats.map((stat) => stat.frames);
	const wire = stats.map((stat) => stat.wireBytes);
	const totalWire = wire.reduce((sum, value) => sum + value, 0);
	const totalEvents = events.reduce((sum, value) => sum + value, 0);
	// Chars per delivered event: how many source deltas the coalescer folded into one. Timing
	// independent — a merged event stops at the 32 KiB cap, not at a flush tick.
	const charsPerEvent = stats.map((stat) => (stat.received > 0 ? Math.floor(stat.chars / stat.received) : 0));

	return {
		wallMs,
		drainMs,
		cpuMs: Math.round((cpuDelta.user + cpuDelta.system) / 1000),
		eventsMin: Math.min(...events),
		eventsMax: Math.max(...events),
		charsMin: Math.min(...chars),
		mergedFramesMin: Math.min(...merged),
		framesMin: Math.min(...frames),
		framesMax: Math.max(...frames),
		wireBytesMin: Math.min(...wire),
		wireBytesMax: Math.max(...wire),
		wireBytesAvg: Math.round(totalWire / Math.max(clientCount, 1)),
		charsPerEventMin: Math.min(...charsPerEvent),
		eventsPerSec: Number(((totalEvents / Math.max(wallMs, 1)) * 1000).toFixed(0)),
		p50Ms: percentile(latencies, 50),
		p99Ms: percentile(latencies, 99),
	};
}

await runScenario(async () => {
	const handle = await startBenchServer();
	const metrics: ScenarioMetrics = {
		deltaChars: DELTA_CHARS,
		homedirObserved: handle.homedirObserved,
		homeHonorsEnv: handle.homedirObserved === handle.envHome,
		broskiDirCreated: handle.broskiDirCreated(),
	};

	try {
		for (const clientCount of CLIENT_COUNTS) {
			const phase = await runPhase(handle, clientCount);
			const prefix = `c${clientCount}`;
			metrics[`${prefix}_clients`] = clientCount;
			metrics[`${prefix}_sent`] = EVENTS;
			metrics[`${prefix}_wallMs`] = phase.wallMs;
			metrics[`${prefix}_drainMs`] = phase.drainMs;
			metrics[`${prefix}_cpuMs`] = phase.cpuMs;
			metrics[`${prefix}_eventsMin`] = phase.eventsMin;
			metrics[`${prefix}_eventsMax`] = phase.eventsMax;
			metrics[`${prefix}_charsMin`] = phase.charsMin;
			metrics[`${prefix}_mergedFramesMin`] = phase.mergedFramesMin;
			metrics[`${prefix}_framesMin`] = phase.framesMin;
			metrics[`${prefix}_framesMax`] = phase.framesMax;
			metrics[`${prefix}_wireBytesMin`] = phase.wireBytesMin;
			metrics[`${prefix}_wireBytesMax`] = phase.wireBytesMax;
			metrics[`${prefix}_wireBytesAvg`] = phase.wireBytesAvg;
			metrics[`${prefix}_charsPerEventMin`] = phase.charsPerEventMin;
			metrics[`${prefix}_eventsPerSec`] = phase.eventsPerSec;
			metrics[`${prefix}_p50Ms`] = phase.p50Ms;
			metrics[`${prefix}_p99Ms`] = phase.p99Ms;
		}
	} finally {
		handle.stop();
	}

	return metrics;
});
