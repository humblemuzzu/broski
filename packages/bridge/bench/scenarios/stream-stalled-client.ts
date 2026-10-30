import "../lib/bench-home";
import { connect } from "node:net";
import type { ServerMessage } from "../../src/types";
import type { BroskiAssistantTextDeltaEvent } from "../../src/types/runtime";
import { type BenchServerHandle, startBenchServer } from "../lib/bench-server";
import { runScenario } from "../lib/report";
import type { ScenarioMetrics } from "../lib/types";
import { connectBenchClient, parseFrame, watchSession } from "../lib/ws-client";

const EVENTS = 200_000;
const CHUNK = 2_000;
const DELTA_CHARS = 120;
const DELTA = "x".repeat(DELTA_CHARS);

/**
 * A phone that stopped reading: a raw socket that completes the WebSocket handshake, asks to
 * view the session, and then never drains what the bridge sends it.
 */
function stalledClient(port: number, token: string, sessionId: string): { closed: () => boolean } {
	const socket = connect(port, "127.0.0.1");
	let closed = false;
	socket.on("close", () => {
		closed = true;
	});
	socket.on("error", () => {
		closed = true;
	});
	socket.on("connect", () => {
		socket.write(
			[
				`GET /ws HTTP/1.1`,
				`Host: 127.0.0.1:${port}`,
				"Upgrade: websocket",
				"Connection: Upgrade",
				"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version: 13",
				`Sec-WebSocket-Protocol: broski-auth.${token}`,
				"",
				"",
			].join("\r\n"),
		);
	});
	let watched = false;
	socket.on("data", () => {
		// Read only the upgrade response, then stop draining: everything after it piles up.
		if (watched) return;
		watched = true;
		socket.write(maskedTextFrame(JSON.stringify({ type: "set_view", agent: "claude-code", sessionId })));
		socket.pause();
	});
	return { closed: () => closed };
}

function maskedTextFrame(text: string): Buffer {
	const payload = Buffer.from(text, "utf8");
	const mask = Buffer.from([1, 2, 3, 4]);
	const header = Buffer.alloc(payload.length < 126 ? 6 : 8);
	header[0] = 0x81;
	if (payload.length < 126) {
		header[1] = 0x80 | payload.length;
		mask.copy(header, 2);
	} else {
		header[1] = 0x80 | 126;
		header.writeUInt16BE(payload.length, 2);
		mask.copy(header, 4);
	}
	const masked = Buffer.alloc(payload.length);
	for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i]! ^ mask[i % 4]!;
	return Buffer.concat([header, masked]);
}

function buildEvent(): ServerMessage {
	const event: BroskiAssistantTextDeltaEvent = {
		type: "assistant_text_delta",
		backend: "claude-code",
		timestampMs: Date.now(),
		sessionId: "bench-session",
		streamId: "bench-stream",
		delta: DELTA,
	};
	return { type: "runtime_event", backend: "claude-code", data: event };
}

function charsInFrame(data: unknown): { events: number; chars: number } {
	const parsed = parseFrame(data);
	if (!parsed) return { events: 0, chars: 0 };
	const messages = parsed.type === "batch" ? (parsed.messages as unknown[]) : [parsed];
	let events = 0;
	let chars = 0;
	for (const raw of messages) {
		if (typeof raw !== "object" || raw === null) continue;
		const message = raw as Record<string, unknown>;
		if (message.type !== "runtime_event") continue;
		const body = message.data;
		if (typeof body !== "object" || body === null) continue;
		const record = body as Record<string, unknown>;
		if (record.type !== "assistant_text_delta") continue;
		events += 1;
		chars += String(record.delta ?? "").length;
	}
	return { events, chars };
}

async function waitForConnections(handle: BenchServerHandle, expected: number): Promise<number> {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		const count = handle.server.connections();
		if (count >= expected) return count;
		await Bun.sleep(20);
	}
	return handle.server.connections();
}

await runScenario(async () => {
	const handle = await startBenchServer();
	const metrics: ScenarioMetrics = {};
	const rssBefore = process.memoryUsage.rss();

	try {
		const healthy = await connectBenchClient(handle.port, handle.token);
		let healthyChars = 0;
		let healthyEvents = 0;
		let healthyCharsAtShed = 0;
		healthy.addEventListener("message", (event) => {
			const counted = charsInFrame(event.data);
			healthyEvents += counted.events;
			healthyChars += counted.chars;
		});
		watchSession(healthy, "claude-code", "bench-session");

		const stalled = stalledClient(handle.port, handle.token, "bench-session");
		const connections = await waitForConnections(handle, 2);
		await Bun.sleep(50);

		const startedAt = Date.now();
		let shedAtMs = -1;
		let rssAtShed = 0;
		for (let sent = 0; sent < EVENTS; sent += CHUNK) {
			for (let i = 0; i < CHUNK; i += 1) handle.server.broadcast(buildEvent());
			await Bun.sleep(1);
			if (shedAtMs < 0 && (stalled.closed() || handle.server.connections() < 2)) {
				shedAtMs = Date.now() - startedAt;
				rssAtShed = process.memoryUsage.rss();
				healthyCharsAtShed = healthyChars;
			}
		}

		// Give the healthy client time to drain whatever the bridge still holds for it.
		const drainDeadline = Date.now() + 10_000;
		while (Date.now() < drainDeadline && healthyChars < EVENTS * DELTA_CHARS) {
			await Bun.sleep(25);
		}
		const rssAfter = process.memoryUsage.rss();

		metrics.clientsConnected = connections;
		metrics.eventsSent = EVENTS;
		metrics.healthyChars = healthyChars;
		metrics.healthyEvents = healthyEvents;
		metrics.healthyComplete = healthyChars >= EVENTS * DELTA_CHARS;
		metrics.healthyCharsAtShed = healthyCharsAtShed;
		metrics.healthyKeptStreaming = healthyChars > healthyCharsAtShed;
		metrics.stalledShed = shedAtMs >= 0;
		metrics.stalledShedAtMs = shedAtMs;
		metrics.stalledShedAtTick = shedAtMs < 0 ? -1 : Math.round((shedAtMs / Math.max(1, Date.now() - startedAt)) * 100);
		metrics.connectionsAfterShed = handle.server.connections();
		metrics.rssBeforeMb = Math.round(rssBefore / 1024 ** 2);
		metrics.rssAtShedMb = Math.round(rssAtShed / 1024 ** 2);
		metrics.rssAfterMb = Math.round(rssAfter / 1024 ** 2);
		metrics.rssGrowthMb = Math.round((rssAfter - rssBefore) / 1024 ** 2);
		metrics.wallMs = Date.now() - startedAt;

		healthy.close();
	} finally {
		handle.stop();
	}

	return metrics;
});
