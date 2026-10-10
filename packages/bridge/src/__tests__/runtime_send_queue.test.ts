import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../types";
import { RuntimeSendQueue } from "../utils/runtime-send-queue";

type FakeSocket = {
	send: (payload: string | Uint8Array) => number;
	sent: string[];
	/** What the next `send` returns; `> 0` means bytes accepted. */
	status: number;
};

function fakeSocket(): ServerWebSocket<unknown> & FakeSocket {
	const socket: FakeSocket = {
		status: 1,
		sent: [],
		send(payload) {
			if (typeof payload === "string") socket.sent.push(payload);
			return socket.status;
		},
	};
	return socket as unknown as ServerWebSocket<unknown> & FakeSocket;
}

function delta(seq: number): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "assistant_text_delta",
			backend: "pi",
			timestampMs: seq,
			sessionId: "sess-1",
			streamId: "s1",
			seq,
			delta: "x",
		},
	};
}

function newQueue(onDeadSocket: (ws: ServerWebSocket<unknown>, reason: "dropped" | "overflow") => void) {
	return new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }), { onDeadSocket });
}

describe("RuntimeSendQueue backpressure", () => {
	test("a congested socket holds batchable deltas and delivers them on drain", async () => {
		const socket = fakeSocket();
		const queue = newQueue(() => {});
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		for (let i = 1; i <= 3; i += 1) queue.send(socket, delta(i));
		await Bun.sleep(40);

		expect(socket.sent).toHaveLength(0);
		expect(queue.stats().pendingFrames).toBe(3);
		expect(queue.stats().congested).toBeGreaterThan(0);

		socket.status = 1;
		queue.onDrain(socket);

		expect(socket.sent).toHaveLength(1);
		const batch = JSON.parse(socket.sent[0]!) as { type: string; count: number };
		expect(batch).toMatchObject({ type: "batch", count: 3 });
		expect(queue.stats().pendingFrames).toBe(0);
	});

	test("sheds a socket that falls too far behind", async () => {
		const socket = fakeSocket();
		const shed: string[] = [];
		const queue = newQueue((_ws, reason) => shed.push(reason));
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		for (let i = 1; i <= 4200; i += 1) queue.send(socket, delta(i));

		expect(shed).toEqual(["overflow"]);
		expect(queue.stats().shed).toBe(1);
		expect(queue.stats().pendingFrames).toBe(0);
		expect(socket.sent).toHaveLength(0);
	});

	test("a dropped frame closes the socket instead of growing the buffer", () => {
		const socket = fakeSocket();
		const shed: string[] = [];
		const queue = newQueue((_ws, reason) => shed.push(reason));
		socket.status = 0;

		queue.sendRaw(socket, "{}");

		expect(shed).toEqual(["dropped"]);
		expect(queue.stats().drops).toBe(1);
	});

	test("non-batchable messages are sent at once, not queued", () => {
		const socket = fakeSocket();
		const queue = newQueue(() => {});

		queue.send(socket, { type: "device_disconnected", data: {} } as unknown as ServerMessage);

		expect(socket.sent).toHaveLength(1);
		expect(queue.stats().pendingFrames).toBe(0);
	});

	test("payloads held while congested are written on the next flush", async () => {
		const socket = fakeSocket();
		const queue = newQueue(() => {});
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		queue.sendPayload(socket, '{"type":"pd_thing"}');
		await Bun.sleep(5);
		expect(socket.sent).toHaveLength(0);
		expect(queue.stats().pendingFrames).toBe(1);

		socket.status = 1;
		queue.onDrain(socket);
		expect(socket.sent).toEqual(['{"type":"pd_thing"}']);
	});
});
