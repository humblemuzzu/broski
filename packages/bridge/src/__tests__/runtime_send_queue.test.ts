import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createLimits } from "../server/limits";
import { isLinkTransportSocket, linkSendLimits } from "../server/link-send-policy";
import { NETWORK_SEND_LIMITS, RESPONSE_TOO_LARGE_CODE, RESPONSE_TOO_LARGE_MESSAGE } from "../transport/send-limits";
import type { ServerMessage } from "../types";
import { type QueueHooks, RuntimeSendQueue } from "../utils/runtime-send-queue";

type FakeSocket = {
	send: (payload: string | Uint8Array) => number;
	getBufferedAmount: () => number;
	sent: string[];
	/** What the next `send` returns; `> 0` means bytes accepted. */
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
	return new RuntimeSendQueue(() => ({ lastRttMs: 0 }), { onDeadSocket });
}

function linkSocket(): ServerWebSocket<unknown> & FakeSocket {
	const socket = fakeSocket();
	(socket as unknown as { data: unknown }).data = { kind: "link", deviceId: "0123456789abcdef0123456789abcdef" };
	return socket;
}

function transcriptReply(text: string, requestId: string): ServerMessage {
	return { type: "pi_session_messages", data: [{ role: "assistant", text }], requestId } as ServerMessage;
}

describe("RuntimeSendQueue backpressure", () => {
	test("a congested socket holds batchable deltas and delivers them on drain", () => {
		const socket = fakeSocket();
		const queue = newQueue(() => {});
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		for (let i = 1; i <= 3; i += 1) queue.send(socket, delta(i));

		// The batch timer is armed but has not run: a congested socket takes nothing.
		queue.flush(socket);
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

	test("payloads held while congested are written on the next flush", () => {
		const socket = fakeSocket();
		const queue = newQueue(() => {});
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		queue.sendPayload(socket, '{"type":"pd_thing"}');
		queue.flush(socket);
		expect(socket.sent).toHaveLength(0);
		expect(queue.stats().pendingFrames).toBe(1);

		socket.status = 1;
		queue.onDrain(socket);
		expect(socket.sent).toEqual(['{"type":"pd_thing"}']);
	});
});

describe("RuntimeSendQueue broadcast", () => {
	test("a shed socket is not written to, and the healthy ones in the same fan-out still are", () => {
		const shed = fakeSocket();
		const healthy = fakeSocket();
		const queue = newQueue(() => {});
		shed.status = 0;
		queue.sendRaw(shed, "{}");
		shed.sent.length = 0;

		const message = { type: "device_disconnected", data: {} } as unknown as ServerMessage;
		queue.broadcast(new Set([shed, healthy]), message);

		expect(shed.sent).toEqual([]);
		expect(healthy.sent).toEqual([JSON.stringify(message)]);
	});
});

describe("RuntimeSendQueue link limits", () => {
	const limits = createLimits();
	const linkLimits = linkSendLimits(limits);
	const queue = new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }), {
		limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
	});
	const overLimit = "x".repeat(limits.linkMessageLimitBytes);

	test("a reply the link cannot take is refused with the caller's requestId and never written", () => {
		const socket = linkSocket();
		const message = transcriptReply(overLimit, "big-1");

		queue.send(socket, message);

		expect(socket.sent).toHaveLength(1);
		const refusal = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
		expect(refusal).toMatchObject({
			type: "error",
			code: RESPONSE_TOO_LARGE_CODE,
			requestId: "big-1",
			limit: limits.linkMessageLimitBytes,
			message: RESPONSE_TOO_LARGE_MESSAGE,
		});
		expect(refusal.bytes).toBeGreaterThan(limits.linkMessageLimitBytes);
		expect(socket.sent[0]).not.toContain(overLimit);
	});

	test("a reply under the limit is written untouched", () => {
		const socket = linkSocket();
		queue.send(socket, transcriptReply("small", "small-1"));
		expect(socket.sent).toHaveLength(1);
		expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "pi_session_messages", requestId: "small-1" });
	});

	test("a network socket has no frame cap", () => {
		const socket = fakeSocket();
		const message = transcriptReply(overLimit, "net-1");
		queue.send(socket, message);
		expect(socket.sent).toEqual([JSON.stringify(message)]);
	});
});

describe("RuntimeSendQueue on a link socket", () => {
	const limits = createLimits();
	const linkLimits = linkSendLimits(limits);
	function linkQueue(hooks: QueueHooks = {}) {
		return new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }), {
			limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
			...hooks,
		});
	}

	function toolFinished(output: string): ServerMessage {
		return {
			type: "runtime_event",
			backend: "pi",
			data: {
				type: "tool_finished",
				backend: "pi",
				timestampMs: 1,
				sessionId: "sess-1",
				toolCallId: "call-1",
				toolName: "bash",
				output,
			},
		} as ServerMessage;
	}

	test("a tool_finished too large for the link is shrunk, never dropped", () => {
		const socket = linkSocket();
		const queue = linkQueue({});

		queue.send(socket, toolFinished("y".repeat(limits.linkMessageLimitBytes + 1024)));

		expect(socket.sent).toHaveLength(1);
		const frame = JSON.parse(socket.sent[0]!) as {
			truncated?: boolean;
			data: { type: string; toolCallId?: string; output: string; truncated?: boolean };
		};
		expect(frame.truncated).toBe(true);
		expect(frame.data.type).toBe("tool_finished");
		expect(frame.data.toolCallId).toBe("call-1");
		expect(frame.data.truncated).toBe(true);
		expect(frame.data.output).toContain("truncated by the bridge");
		expect(Buffer.byteLength(socket.sent[0]!, "utf8")).toBeLessThanOrEqual(limits.linkMessageLimitBytes);
	});

	test("held deltas are written before the shrunk frame that follows them", () => {
		const socket = linkSocket();
		const queue = linkQueue({});

		queue.send(socket, delta(1));
		expect(socket.sent).toHaveLength(0);

		queue.send(socket, toolFinished("z".repeat(limits.linkMessageLimitBytes + 1024)));

		expect(socket.sent).toHaveLength(2);
		const first = JSON.parse(socket.sent[0]!) as { type: string };
		expect(first.type).toBe("runtime_event");
		expect(JSON.parse(socket.sent[1]!).data.type).toBe("tool_finished");
	});

	test("a payload refused for size answers its own request id", () => {
		const socket = linkSocket();
		const queue = linkQueue({});
		const refusals: string[] = [];

		queue.sendPayload(
			socket,
			JSON.stringify({ type: "pd_transcript", requestId: "pd-7", data: "x".repeat(limits.linkMessageLimitBytes) }),
			"pd-7",
		);

		expect(socket.sent).toHaveLength(1);
		const refusal = JSON.parse(socket.sent[0]!) as { code: string; requestId?: string };
		expect(refusal.code).toBe(RESPONSE_TOO_LARGE_CODE);
		expect(refusal.requestId).toBe("pd-7");
		expect(refusals).toEqual([]);
	});

	test("a raw frame refused for size answers without a request id", () => {
		const socket = linkSocket();
		const refusals: Array<{ type: string; bytes: number }> = [];
		const queue = linkQueue({ onResponseTooLarge: (_ws, detail) => refusals.push(detail) });

		expect(queue.sendRaw(socket, "x".repeat(limits.linkMessageLimitBytes + 1))).toBe("dropped");

		expect(refusals).toHaveLength(1);
		const refusal = JSON.parse(socket.sent[0]!) as { code: string; requestId?: string };
		expect(refusal.code).toBe(RESPONSE_TOO_LARGE_CODE);
		expect(refusal.requestId).toBeUndefined();
	});

	test("a merged batch too large for the link goes out as its parts", () => {
		const socket = linkSocket();
		const queue = linkQueue({});
		const half = Math.floor(limits.linkMessageLimitBytes / 2);

		// Two deltas that fit alone and cannot be merged inside one frame.
		for (let i = 1; i <= 2; i += 1) {
			queue.send(socket, {
				type: "runtime_event",
				backend: "pi",
				data: {
					type: "assistant_text_delta",
					backend: "pi",
					timestampMs: i,
					sessionId: "sess-1",
					seq: i,
					delta: "d".repeat(half),
				},
			} as ServerMessage);
		}
		queue.flush(socket);

		expect(socket.sent).toHaveLength(2);
		for (const frame of socket.sent) {
			expect(JSON.parse(frame).type).toBe("runtime_event");
			expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(limits.linkMessageLimitBytes);
		}
	});
});

describe("RuntimeSendQueue when the daemon has not read a burst of replies", () => {
	const limits = createLimits();
	const linkLimits = linkSendLimits(limits);
	const REPLY_BYTES = 4 * 1024 * 1024;

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

	function newLinkQueue() {
		const closed: Array<{ reason: string; detail?: string }> = [];
		const queue = new RuntimeSendQueue(() => ({ lastRttMs: 0 }), {
			limitsFor: (ws) => (isLinkTransportSocket(ws.data) ? linkLimits : NETWORK_SEND_LIMITS),
			onDeadSocket: (_ws, reason, detail) => closed.push({ reason, detail }),
		});
		return { queue, closed };
	}

	function reply(index: number): ServerMessage {
		return transcriptReply("r".repeat(REPLY_BYTES), `req-${index}`);
	}

	function requestIdsSent(socket: FakeSocket): string[] {
		return socket.sent.map((frame) => (JSON.parse(frame) as { requestId: string }).requestId);
	}

	test("replies that do not fit the window wait in the queue instead of closing the socket", () => {
		const socket = bufferedLinkSocket();
		const { queue, closed } = newLinkQueue();
		const fitting = Math.floor(linkLimits.maxPendingBytes / REPLY_BYTES);

		for (let index = 0; index < fitting + 3; index += 1) queue.send(socket, reply(index));

		expect(closed).toEqual([]);
		expect(socket.sent).toHaveLength(fitting - 1);
		expect(queue.stats().pendingFrames).toBe(4);
	});

	test("the held replies are written in order once the daemon has read", () => {
		const socket = bufferedLinkSocket();
		const { queue, closed } = newLinkQueue();
		const total = Math.floor(linkLimits.maxPendingBytes / REPLY_BYTES) + 3;
		for (let index = 0; index < total; index += 1) queue.send(socket, reply(index));

		socket.buffered = 0;
		queue.onDrain(socket);

		expect(closed).toEqual([]);
		expect(requestIdsSent(socket)).toEqual(Array.from({ length: total }, (_, index) => `req-${index}`));
	});

	test("a reply sent while others are held does not overtake them", () => {
		const socket = bufferedLinkSocket();
		const { queue } = newLinkQueue();
		const total = Math.floor(linkLimits.maxPendingBytes / REPLY_BYTES) + 1;
		for (let index = 0; index < total; index += 1) queue.send(socket, reply(index));
		socket.buffered = 0;

		queue.send(socket, transcriptReply("tiny", "req-late"));
		queue.onDrain(socket);

		expect(requestIdsSent(socket).at(-1)).toBe("req-late");
		expect(requestIdsSent(socket).slice(0, total)).toEqual(Array.from({ length: total }, (_, index) => `req-${index}`));
	});

	test("the socket is closed with 4013 once the held replies fill a second window, and says what it held", () => {
		const socket = bufferedLinkSocket();
		const { queue, closed } = newLinkQueue();
		const doubleWindow = Math.ceil((linkLimits.maxPendingBytes + linkLimits.maxHeldBytes) / REPLY_BYTES);

		for (let index = 0; index < doubleWindow + 2 && closed.length === 0; index += 1) queue.send(socket, reply(index));

		expect(closed).toHaveLength(1);
		expect(closed[0]?.reason).toBe("overflow");
		expect(closed[0]?.detail).toMatch(/^buffered=\d+B held=\d+B deltas=\d+B frames=\d+$/);
	});
});
