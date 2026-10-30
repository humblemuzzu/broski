/**
 * What the bridge does while a link socket's peer is not reading, against a real bridge, a real
 * unix socket and a real network socket. The peer of a link socket is the daemon: it stops reading
 * whenever the phone is behind, and that must never cost the connection below its own window.
 */

import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LINK_OVERFLOW_CLOSE_CODE, LINK_OVERFLOW_CLOSE_REASON } from "../transport/send-limits";
import type { ServerMessage } from "../types";
import { type BridgeHandle, connect, E2E_TEST_TIMEOUT_MS, setupTestEnv, startBridge, viewSession } from "./e2e/harness";
import { connectUnixWs, type UnixWsClient } from "./link/unix-ws";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
const root = mkdtempSync(join(tmpdir(), "broski-link-backpressure-"));
const socketPath = join(root, "run", "link.sock");
const DEVICE_HEADERS = {
	"x-broski-device-id": "0123456789abcdef0123456789abcdef",
	"x-broski-device-name": "Backpressure Phone",
	"x-broski-role": "owner",
};

/** The link window this file runs with; the network window stays at its own 4 MiB. */
const LINK_WINDOW_MB = 8;
process.env.BROSKI_LINK_BACKPRESSURE_MB = String(LINK_WINDOW_MB);
const NETWORK_WINDOW_MB = 4;

const FILLER = "x".repeat(1024);
/** One broadcast event's payload, near enough: the filler plus its envelope. */
const EVENT_BYTES = 1024;
const CLOSE_TIMEOUT_MS = 20_000;

const eventsForMiB = (mib: number): number => Math.ceil((mib * 1024 * 1024) / EVENT_BYTES);

function toolEvent(sessionId: string, marker: number): ServerMessage {
	return {
		type: "runtime_event",
		backend: "claude-code",
		data: {
			type: "tool_started",
			backend: "claude-code",
			timestampMs: Date.now(),
			sessionId,
			toolCallId: `tool-${marker}`,
			toolName: "Read",
			backendData: { marker, filler: FILLER },
		},
	};
}

function deltaEvent(sessionId: string, marker: number): ServerMessage {
	return {
		type: "runtime_event",
		backend: "claude-code",
		data: {
			type: "assistant_text_delta",
			backend: "claude-code",
			timestampMs: Date.now(),
			sessionId,
			streamId: "s1",
			delta: FILLER,
			backendData: { marker },
		},
	};
}

function markerOf(frame: Record<string, unknown>): number {
	const data = frame.data as { backendData?: { marker?: number } } | undefined;
	const marker = data?.backendData?.marker;
	if (typeof marker !== "number") throw new Error("frame carries no marker");
	return marker;
}

function markersOf(client: UnixWsClient): number[] {
	return client
		.frames()
		.filter((frame) => frame.type === "runtime_event")
		.map(markerOf);
}

/** Broadcasts until the bridge has no sockets left, or the deadline passes. */
async function floodUntilClosed(bridge: BridgeHandle, event: (marker: number) => ServerMessage): Promise<number> {
	let produced = 0;
	const deadline = Date.now() + CLOSE_TIMEOUT_MS;
	while (bridge.server.connections() > 0 && Date.now() < deadline) {
		for (let i = 0; i < 500; i += 1) {
			bridge.server.broadcast(event(produced));
			produced += 1;
		}
		await Bun.sleep(1);
	}
	return produced;
}

afterAll(() => {
	env.restore();
	delete process.env.BROSKI_LINK_BACKPRESSURE_MB;
	rmSync(root, { recursive: true, force: true });
});

describe("broski-link send window", () => {
	test("a stalled link socket survives past the network's 4 MiB and closes with 4013 at its own window", async () => {
		const bridge = await startBridge({ linkSocket: socketPath });
		const client = await connectUnixWs(socketPath, DEVICE_HEADERS);
		try {
			client.pause();
			const burst = eventsForMiB(NETWORK_WINDOW_MB + 1);
			for (let i = 0; i < burst; i += 1) {
				bridge.server.broadcast(toolEvent("window-session", i));
			}
			// A close is synchronous in the queue, so a wrong window has already taken the socket
			// by now; there is nothing to wait for before saying it did not.
			expect(bridge.server.connections()).toBe(1);
			expect(client.closed()).toBeNull();

			const produced = await floodUntilClosed(bridge, (marker) => toolEvent("window-session", marker));
			expect(bridge.server.connections()).toBe(0);
			// The socket carried everything it was given until its own window filled, and that
			// window is wider than the network's. What it takes before the close is bounded by the
			// socket's window plus the frames the queue holds for it.
			const carriedMiB = ((burst + produced) * EVENT_BYTES) / (1024 * 1024);
			expect(carriedMiB).toBeGreaterThan(NETWORK_WINDOW_MB);
			expect(carriedMiB).toBeLessThanOrEqual(2 * LINK_WINDOW_MB);

			client.resume();
			const close = await client.waitForClose(CLOSE_TIMEOUT_MS);
			expect(close).toEqual({ code: LINK_OVERFLOW_CLOSE_CODE, reason: LINK_OVERFLOW_CLOSE_REASON });
		} finally {
			client.close();
			await bridge.stop();
		}
	});

	test("a link client that pauses and resumes gets every message, in order, once", async () => {
		const bridge = await startBridge({ linkSocket: socketPath });
		const client = await connectUnixWs(socketPath, DEVICE_HEADERS);
		try {
			const total = eventsForMiB(NETWORK_WINDOW_MB + 1);
			client.pause();
			for (let i = 0; i < total; i += 1) bridge.server.broadcast(toolEvent("pause-session", i));
			client.resume();

			const deadline = Date.now() + CLOSE_TIMEOUT_MS;
			while (markersOf(client).length < total && Date.now() < deadline) await Bun.sleep(10);

			expect(client.closed()).toBeNull();
			expect(markersOf(client)).toEqual(Array.from({ length: total }, (_, index) => index));
		} finally {
			client.close();
			await bridge.stop();
		}
	});

	test("a network socket is still shed at its own 4 MiB with 1013 in the same run", async () => {
		const bridge = await startBridge();
		const client = await connect(bridge.port, bridge.token);
		try {
			const closed = new Promise<{ code: number; reason: string }>((resolve) => {
				client.ws.addEventListener("close", (event) => {
					const close = event as CloseEvent;
					resolve({ code: close.code, reason: close.reason });
				});
			});
			await viewSession(client.ws, client.messages, "claude-code", "shed-session");

			let produced = 0;
			const deadline = Date.now() + CLOSE_TIMEOUT_MS;
			while (bridge.server.connections() > 0 && Date.now() < deadline) {
				for (let i = 0; i < 2000; i += 1) {
					bridge.server.broadcast(deltaEvent("shed-session", produced));
					produced += 1;
				}
				await Bun.sleep(1);
			}

			expect(bridge.server.connections()).toBe(0);
			expect(produced).toBeGreaterThan(eventsForMiB(NETWORK_WINDOW_MB));
			expect(await closed).toEqual({ code: 1013, reason: "backpressure" });
		} finally {
			client.ws.close();
			await bridge.stop();
		}
	});
});
