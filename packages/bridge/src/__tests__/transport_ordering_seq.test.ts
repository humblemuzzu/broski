import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { RuntimeEventCoalescer } from "../transport/runtime-event-coalescer";
import type { ServerMessage } from "../types";
import type { BroskiRuntimeEvent } from "../types/runtime";
import { RuntimeSendQueue } from "../utils/runtime-send-queue";

type DeltaEvent = Extract<BroskiRuntimeEvent, { delta: string }>;

type FakeSocket = {
	send: (payload: string | Uint8Array) => number;
	sent: string[];
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

function delta(text: string, seq: number, streamId = "s1", sessionId = "sess-1"): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "assistant_text_delta",
			backend: "pi",
			timestampMs: 1000 + seq,
			sessionId,
			streamId,
			seq,
			delta: text,
		} satisfies BroskiRuntimeEvent,
	};
}

function thinking(text: string, seq: number): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "assistant_thinking_delta",
			backend: "pi",
			timestampMs: 1000 + seq,
			sessionId: "sess-1",
			streamId: "s1",
			seq,
			delta: text,
		} satisfies BroskiRuntimeEvent,
	};
}

function toolStarted(seq: number): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "tool_started",
			backend: "pi",
			timestampMs: 1000 + seq,
			sessionId: "sess-1",
			seq,
			toolName: "read",
		} satisfies BroskiRuntimeEvent,
	};
}

function eventOf(message: ServerMessage): BroskiRuntimeEvent {
	if (message.type !== "runtime_event") throw new Error("expected a runtime event");
	return message.data;
}

function deltaEvent(message: ServerMessage): DeltaEvent {
	const event = eventOf(message);
	if (event.type !== "assistant_text_delta" && event.type !== "assistant_thinking_delta") {
		throw new Error(`expected a delta, got ${event.type}`);
	}
	return event;
}

function frames(sent: string[]): ServerMessage[] {
	const out: ServerMessage[] = [];
	for (const payload of sent) {
		const frame = JSON.parse(payload) as { type?: string; messages?: ServerMessage[] };
		if (frame.type === "batch" && frame.messages) out.push(...frame.messages);
		else out.push(frame as unknown as ServerMessage);
	}
	return out;
}

describe("merged delta seq range", () => {
	test("a merged frame records the seq of its first delta", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(delta("Hel", 1));
		coalescer.push(delta("lo ", 2));
		coalescer.push(delta("world", 3));
		await Bun.sleep(30);

		expect(emitted).toHaveLength(1);
		const event = deltaEvent(emitted[0]!);
		expect(event.delta).toBe("Hello world");
		expect(event.seq).toBe(3);
		expect(event.seqStart).toBe(1);
	});

	test("thinking deltas carry the same range", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(thinking("a", 7));
		coalescer.push(thinking("b", 8));
		await Bun.sleep(30);

		const event = deltaEvent(emitted[0]!);
		expect(event.seq).toBe(8);
		expect(event.seqStart).toBe(7);
	});

	test("an unmerged delta carries no seqStart", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(delta("only", 4));
		await Bun.sleep(30);

		expect(deltaEvent(emitted[0]!)).not.toHaveProperty("seqStart");
	});

	test("consecutive merged frames cover a contiguous range", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(delta("a", 10));
		coalescer.push(delta("b", 11));
		await Bun.sleep(30);
		coalescer.push(delta("c", 12));
		coalescer.push(delta("d", 13));
		await Bun.sleep(30);

		expect(emitted).toHaveLength(2);
		const first = deltaEvent(emitted[0]!);
		const second = deltaEvent(emitted[1]!);
		expect([first.seqStart, first.seq]).toEqual([10, 11]);
		expect([second.seqStart, second.seq]).toEqual([12, 13]);
		expect(second.seqStart).toBe(first.seq! + 1);
	});
});

describe("send queue ordering", () => {
	test("a tool event is written after the deltas that preceded it", async () => {
		const socket = fakeSocket();
		const queue = new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }));

		queue.send(socket, delta("a", 1));
		queue.send(socket, delta("b", 2));
		queue.send(socket, toolStarted(3));
		queue.send(socket, delta("c", 4));
		await Bun.sleep(40);

		const events = frames(socket.sent).map(eventOf);
		expect(events.map((event) => event.type)).toEqual([
			"assistant_text_delta",
			"assistant_text_delta",
			"tool_started",
			"assistant_text_delta",
		]);
		expect(
			events.filter((event): event is DeltaEvent => event.type === "assistant_text_delta").map((event) => event.delta),
		).toEqual(["a", "b", "c"]);
	});

	test("a congested socket keeps the tool event behind the held deltas", async () => {
		const socket = fakeSocket();
		const queue = new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }));
		socket.status = -1;
		queue.sendRaw(socket, '{"warm":true}');
		socket.sent.length = 0;

		queue.send(socket, delta("a", 1));
		queue.send(socket, toolStarted(2));
		queue.send(socket, delta("b", 3));
		await Bun.sleep(40);
		expect(socket.sent).toHaveLength(0);

		socket.status = 1;
		queue.onDrain(socket);

		const events = frames(socket.sent).map(eventOf);
		expect(events.map((event) => event.type)).toEqual(["assistant_text_delta", "tool_started", "assistant_text_delta"]);
	});

	test("a non-runtime message is written after the deltas queued before it", async () => {
		const socket = fakeSocket();
		const queue = new RuntimeSendQueue(() => ({ lastRttMs: 0, connectionType: "local" }));

		queue.send(socket, delta("a", 1));
		queue.send(socket, { type: "device_disconnected", data: {} } as unknown as ServerMessage);
		await Bun.sleep(40);

		expect(socket.sent).toHaveLength(2);
		expect(eventOf(frames(socket.sent)[0]!).type).toBe("assistant_text_delta");
		expect(JSON.parse(socket.sent[1]!)).toMatchObject({ type: "device_disconnected" });
	});
});
