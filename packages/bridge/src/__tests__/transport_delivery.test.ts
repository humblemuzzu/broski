import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { RuntimeEventCoalescer } from "../transport/runtime-event-coalescer";
import { deliverRuntimeEvent } from "../transport/session-delivery";
import { SocketSender } from "../transport/socket-sender";
import type { ServerMessage } from "../types";
import type { BroskiRuntimeEvent } from "../types/runtime";

const wsA = { send: () => 1 } as unknown as ServerWebSocket<unknown>;
const wsB = { send: () => 1 } as unknown as ServerWebSocket<unknown>;

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
		} as BroskiRuntimeEvent,
	};
}

function toolStarted(seq: number, sessionId = "sess-1"): ServerMessage {
	return {
		type: "runtime_event",
		backend: "pi",
		data: {
			type: "tool_started",
			backend: "pi",
			timestampMs: 1000 + seq,
			sessionId,
			seq,
			toolName: "read",
		} satisfies BroskiRuntimeEvent,
	};
}

function textOf(message: ServerMessage): string {
	if (message.type !== "runtime_event") return "";
	const data = message.data;
	if (data.type === "assistant_text_delta" || data.type === "assistant_thinking_delta") return data.delta;
	return "";
}

/** The coalescer flushes on a timer; wait for the frame instead of assuming a delay. */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) await Bun.sleep(5);
}

describe("RuntimeEventCoalescer", () => {
	test("merges consecutive deltas of one stream and keeps the newest seq", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(delta("Hel", 1));
		coalescer.push(delta("lo ", 2));
		coalescer.push(delta("world", 3));
		expect(emitted).toHaveLength(0);

		await waitFor(() => emitted.length >= 1);
		expect(emitted).toHaveLength(1);
		expect(textOf(emitted[0]!)).toBe("Hello world");
		expect(emitted[0]).toMatchObject({ type: "runtime_event", data: { seq: 3, streamId: "s1" } });
	});

	test("keeps separate streams and separate sessions apart", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 5);

		coalescer.push(delta("a", 1, "s1"));
		coalescer.push(delta("b", 2, "s2"));
		coalescer.push(delta("c", 3, "s1", "sess-2"));

		await waitFor(() => emitted.length >= 3);
		expect(emitted).toHaveLength(3);
		expect(emitted.map(textOf).sort()).toEqual(["a", "b", "c"]);
	});

	test("flushes pending deltas before a non-delta event of the same session", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 50);

		coalescer.push(delta("partial", 1));
		coalescer.push(toolStarted(2));

		expect(emitted).toHaveLength(2);
		expect(textOf(emitted[0]!)).toBe("partial");
		expect(emitted[1]).toMatchObject({ data: { type: "tool_started", seq: 2 } });
	});

	test("a delta for another session does not flush this session's pending text", async () => {
		const emitted: ServerMessage[] = [];
		const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), 50);

		coalescer.push(delta("mine", 1, "s1", "sess-1"));
		coalescer.push(toolStarted(2, "sess-2"));

		expect(emitted).toHaveLength(1);
		coalescer.flushAll();
		expect(emitted.map(textOf)).toEqual(["", "mine"]);
	});

	test("carries the explicit target through to the emit callback", async () => {
		const targets: Array<ServerWebSocket<unknown> | null | undefined> = [];
		const coalescer = new RuntimeEventCoalescer((_message, target) => targets.push(target), 5);

		coalescer.push(delta("x", 1), wsB);
		await waitFor(() => targets.length >= 1);
		expect(targets).toEqual([wsB]);
	});
});

describe("session delivery", () => {
	test("viewers and the owner get the event, everyone else gets activity without a seq", async () => {
		const sockets = new Set<ServerWebSocket<unknown>>([wsA, wsB]);
		const viewers = new Set<ServerWebSocket<unknown>>([wsA]);
		const seen: Array<{ ws: ServerWebSocket<unknown>; message: ServerMessage }> = [];
		const send = (ws: ServerWebSocket<unknown>, message: ServerMessage) => seen.push({ ws, message });

		deliverRuntimeEvent({ message: delta("hi", 7), owner: null, viewers, sockets, send });
		expect(seen).toEqual([{ ws: wsA, message: expect.objectContaining({ type: "runtime_event" }) }]);

		seen.length = 0;
		deliverRuntimeEvent({ message: toolStarted(9), owner: null, viewers, sockets, send });
		expect(seen).toHaveLength(2);
		const nonViewer = seen.find((entry) => entry.ws === wsB);
		expect(nonViewer?.message.type).toBe("runtime_event");
		if (nonViewer?.message.type === "runtime_event") {
			expect(nonViewer.message.data).not.toHaveProperty("seq");
			expect(nonViewer.message.data).toMatchObject({ type: "tool_started", sessionId: "sess-1" });
		}
	});

	test("does not send twice to a socket that is both owner and viewer", async () => {
		const seen: ServerWebSocket<unknown>[] = [];
		deliverRuntimeEvent({
			message: delta("once", 1),
			owner: wsA,
			viewers: new Set([wsA]),
			sockets: [wsA],
			send: (ws) => seen.push(ws),
		});
		expect(seen).toEqual([wsA]);
	});

	test("text deltas never reach a socket that is not viewing the session", async () => {
		const seen: Array<{ ws: ServerWebSocket<unknown>; message: ServerMessage }> = [];
		deliverRuntimeEvent({
			message: delta("secret", 1),
			owner: null,
			viewers: undefined,
			sockets: [wsA],
			send: (ws, message) => seen.push({ ws, message }),
		});
		expect(seen).toHaveLength(0);
	});
});

describe("SocketSender", () => {
	test("reports sent, congested and dropped and tracks congestion per socket", async () => {
		const statuses = [7, -1, 7, 0];
		const socket = { send: () => statuses.shift() ?? 1 } as unknown as ServerWebSocket<unknown>;
		const dropped: ServerWebSocket<unknown>[] = [];
		const sender = new SocketSender({ onDropped: (ws) => dropped.push(ws) });

		expect(sender.send(socket, "a")).toBe("sent");
		expect(sender.send(socket, "b")).toBe("congested");
		expect(sender.isCongested(socket)).toBe(true);
		expect(sender.send(socket, "c")).toBe("sent");
		expect(sender.isCongested(socket)).toBe(false);
		expect(sender.send(socket, "d")).toBe("dropped");
		expect(dropped).toEqual([socket]);
		expect(sender.stats()).toMatchObject({ sent: 2, congested: 1, drops: 1 });
	});

	test("a throwing send counts as a drop", async () => {
		const socket = {
			send: () => {
				throw new Error("closed");
			},
		} as unknown as ServerWebSocket<unknown>;
		const sender = new SocketSender();
		expect(sender.send(socket, "x")).toBe("dropped");
		expect(sender.stats().drops).toBe(1);
	});
});
