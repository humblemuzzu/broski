import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createLimits } from "../server/limits";
import { isLinkTransportSocket, linkSendLimits } from "../server/link-send-policy";
import { NETWORK_SEND_LIMITS } from "../transport/send-limits";
import { type QueueHooks, SendQueue } from "../transport/send-queue";

type FakeSocket = {
	send: (payload: string | Uint8Array) => number;
	getBufferedAmount: () => number;
	sent: string[];
	/** What the next `send` returns; `> 0` means bytes accepted, `-1` congested, `0` dropped. */
	status: number;
};

function fakeSocket(): ServerWebSocket<unknown> & FakeSocket {
	const socket: FakeSocket = {
		status: 1,
		sent: [],
		getBufferedAmount: () => 0,
		send(payload) {
			if (typeof payload === "string") socket.sent.push(payload);
			return socket.status;
		},
	};
	return socket as unknown as ServerWebSocket<unknown> & FakeSocket;
}

function linkSocket(): ServerWebSocket<unknown> & FakeSocket {
	const socket = fakeSocket();
	(socket as unknown as { data: unknown }).data = { kind: "link", deviceId: "0123456789abcdef0123456789abcdef" };
	return socket;
}

/** A link socket whose buffer holds whatever was sent until the test lets the daemon read it. */
function bufferedLinkSocket() {
	const socket = linkSocket() as ServerWebSocket<unknown> & FakeSocket & { buffered: number };
	socket.buffered = 0;
	(socket as unknown as { getBufferedAmount: () => number }).getBufferedAmount = () => socket.buffered;
	const send = socket.send;
	socket.send = (payload) => {
		const status = send(payload);
		if (typeof payload === "string") socket.buffered += Buffer.byteLength(payload, "utf8");
		return status;
	};
	return socket;
}

const limits = createLimits();
const linkLimits = linkSendLimits(limits);

function newQueue(hooks: QueueHooks = {}) {
	return new SendQueue({
		limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
		...hooks,
	});
}

function frame(index: number, bytes = 16): string {
	return JSON.stringify({ type: "contract", message: { requestId: `req-${index}`, pad: "r".repeat(bytes) } });
}

function requestIdsSent(socket: FakeSocket): string[] {
	return socket.sent.map((sent) => (JSON.parse(sent) as { message: { requestId: string } }).message.requestId);
}

describe("SendQueue on a network socket", () => {
	test("frames a congested socket cannot take are held and written in order when it drains", () => {
		const socket = fakeSocket();
		const queue = newQueue();
		socket.status = -1;
		queue.sendPayload(socket, frame(0));
		socket.sent.length = 0;
		for (let index = 1; index <= 3; index += 1) queue.sendPayload(socket, frame(index));
		expect(socket.sent).toEqual([]);

		socket.status = 1;
		queue.onDrain(socket);
		expect(requestIdsSent(socket)).toEqual(["req-1", "req-2", "req-3"]);
	});

	test("a socket that owes more than its window is shed, and nothing more is written to it", () => {
		const socket = fakeSocket();
		const shed: string[] = [];
		const queue = newQueue({ onDeadSocket: (_ws, reason) => shed.push(reason) });
		socket.status = -1;
		queue.sendPayload(socket, frame(0));
		socket.sent.length = 0;
		const big = Math.ceil(NETWORK_SEND_LIMITS.maxPendingBytes / 8);
		for (let index = 1; index <= 9; index += 1) queue.sendPayload(socket, frame(index, big));

		expect(shed).toEqual(["overflow"]);
		socket.status = 1;
		queue.onDrain(socket);
		queue.sendPayload(socket, frame(10));
		expect(socket.sent).toEqual([]);
	});

	test("a dropped frame closes the socket instead of growing the buffer", () => {
		const socket = fakeSocket();
		const shed: string[] = [];
		const queue = newQueue({ onDeadSocket: (_ws, reason) => shed.push(reason) });
		socket.status = 0;
		queue.sendPayload(socket, "{}");
		expect(shed).toEqual(["dropped"]);
	});

	test("a network socket has no frame cap", () => {
		const socket = fakeSocket();
		const payload = frame(0, limits.linkMessageLimitBytes);
		newQueue().sendPayload(socket, payload);
		expect(socket.sent).toEqual([payload]);
	});
});

describe("SendQueue on a link socket", () => {
	test("a frame larger than the link takes is refused, reported, and never written", () => {
		const socket = linkSocket();
		const refused: Array<{ bytes: number; limit: number }> = [];
		const queue = newQueue({ onTooLarge: (_ws, detail) => refused.push(detail) });

		queue.sendPayload(socket, frame(0, limits.linkMessageLimitBytes));
		queue.sendPayload(socket, "x".repeat(limits.linkMessageLimitBytes + 1));

		expect(socket.sent).toEqual([]);
		expect(refused).toHaveLength(2);
		expect(refused.every((detail) => detail.limit === limits.linkMessageLimitBytes)).toBe(true);
	});

	const REPLY_BYTES = 4 * 1024 * 1024;

	test("frames that do not fit the window wait in the queue instead of closing the socket", () => {
		const socket = bufferedLinkSocket();
		const closed: string[] = [];
		const queue = newQueue({ onDeadSocket: (_ws, reason) => closed.push(reason) });
		const fitting = Math.floor(linkLimits.maxPendingBytes / REPLY_BYTES);

		for (let index = 0; index < fitting + 3; index += 1) queue.sendPayload(socket, frame(index, REPLY_BYTES));

		expect(closed).toEqual([]);
		expect(socket.sent).toHaveLength(fitting - 1);
	});

	test("the held frames are written in order once the daemon has read, and a later one does not overtake them", () => {
		const socket = bufferedLinkSocket();
		const queue = newQueue();
		const total = Math.floor(linkLimits.maxPendingBytes / REPLY_BYTES) + 3;
		for (let index = 0; index < total; index += 1) queue.sendPayload(socket, frame(index, REPLY_BYTES));
		queue.sendPayload(socket, frame(total));

		socket.buffered = 0;
		queue.onDrain(socket);

		expect(requestIdsSent(socket)).toEqual(Array.from({ length: total + 1 }, (_, index) => `req-${index}`));
	});

	test("the socket is closed once the held frames fill a second window, and says what it held", () => {
		const socket = bufferedLinkSocket();
		const closed: Array<{ reason: string; detail?: string }> = [];
		const queue = newQueue({ onDeadSocket: (_ws, reason, detail) => closed.push({ reason, detail }) });
		const doubleWindow = Math.ceil((linkLimits.maxPendingBytes + linkLimits.maxHeldBytes) / REPLY_BYTES);

		for (let index = 0; index < doubleWindow + 2 && closed.length === 0; index += 1) {
			queue.sendPayload(socket, frame(index, REPLY_BYTES));
		}

		expect(closed).toHaveLength(1);
		expect(closed[0]?.reason).toBe("overflow");
		expect(closed[0]?.detail).toMatch(/^buffered=\d+B held=\d+B frames=\d+$/);
	});
});
