/**
 * The records `RpcClient` holds for delivery, over a transport that, like a socket, passes nothing on while paused: a
 * lookup a delivery awaits is answered however much waits behind it, a tool's progress that a later one of the same call
 * supersedes is never delivered, and the transport is still paused when nothing awaits an answer.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type Delivery, RpcClient } from "../../backends/pi/rpc/client";
import type { PiEnd, PiTransport, TransportSink } from "../../backends/pi/rpc/transport";

class ScriptedTransport implements PiTransport {
	readonly ended: Promise<PiEnd> = new Promise(() => undefined);
	readonly running = true;
	readonly written: Record<string, unknown>[] = [];
	readonly pauses: boolean[] = [];
	private paused = false;
	private held: string[] = [];

	constructor(private readonly sink: TransportSink) {}

	/** Pi writes a record; a paused transport holds it, as an unread socket does. */
	push(record: unknown): void {
		const text = JSON.stringify(record);
		if (this.paused) this.held.push(text);
		else this.sink({ kind: "line", text });
	}

	write(record: string): void {
		this.written.push(JSON.parse(record) as Record<string, unknown>);
	}

	pause(): void {
		this.paused = true;
		this.pauses.push(true);
	}

	resume(): void {
		this.paused = false;
		this.pauses.push(false);
		for (const text of this.held.splice(0)) this.sink({ kind: "line", text });
	}

	stop(): Promise<unknown> {
		return Promise.resolve();
	}

	detach(): void {}
}

function opened(deliver: (client: RpcClient, delivery: Delivery) => void | Promise<void>) {
	let transport: ScriptedTransport | undefined;
	const client: RpcClient = new RpcClient(
		(sink) => {
			transport = new ScriptedTransport(sink);
			return transport;
		},
		(delivery) => deliver(client, delivery),
	);
	if (transport === undefined) throw new Error("the client opened no transport");
	return { client, transport };
}

const BIG = 17 * 1024 * 1024;

function progress(toolCallId: string, text: string, filler = 0) {
	return {
		type: "tool_execution_update",
		toolCallId,
		toolName: "delegate",
		args: {},
		partialResult: { content: [{ type: "text", text }], details: { filler: "x".repeat(filler) } },
	};
}

const typeOf = (delivery: Delivery) => (delivery.kind === "event" ? delivery.event.type : delivery.kind);

describe("a delivery that awaits a lookup", () => {
	test("is answered at once, though more than the pause bound of records waits behind it", async () => {
		let answered: { ok: boolean; at: number } | undefined;
		const { transport } = opened(async (client, delivery) => {
			if (typeOf(delivery) !== "agent_start") return;
			const reply = await client.request({ type: "get_entries" }, z.unknown(), { deadlineMs: 5_000, ordered: false });
			answered = { ok: reply.ok, at: Date.now() };
		});
		const started = Date.now();
		transport.push({ type: "agent_start" });
		await Bun.sleep(0);
		transport.push(progress("call-1", "working", BIG));
		const id = transport.written.find((command) => command.type === "get_entries")?.id;
		transport.push({ type: "response", id, command: "get_entries", success: true, data: {} });
		while (answered === undefined && Date.now() - started < 6_000) await Bun.sleep(5);
		expect(answered?.ok).toBe(true);
		expect((answered?.at ?? Infinity) - started).toBeLessThan(1_000);
	});
});

describe("a tool's progress", () => {
	test("that a later one of the same call supersedes before delivery is dropped; the newest goes in its own place", async () => {
		const gate = Promise.withResolvers<void>();
		const delivered: Delivery[] = [];
		const { transport } = opened(async (_client, delivery) => {
			delivered.push(delivery);
			if (typeOf(delivery) === "agent_start") await gate.promise;
		});
		transport.push({ type: "agent_start" });
		await Bun.sleep(0);
		transport.push(progress("call-1", "first"));
		transport.push(progress("call-2", "other"));
		transport.push(progress("call-1", "second"));
		transport.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi" },
		});
		transport.push(progress("call-1", "third"));
		gate.resolve();
		while (delivered.length < 4) await Bun.sleep(5);
		await Bun.sleep(20);
		const shown = delivered.map((delivery) =>
			delivery.kind === "event" && delivery.event.type === "tool_execution_update"
				? `${delivery.event.toolCallId}:${delivery.event.partialResult.content?.[0]?.type === "text" ? delivery.event.partialResult.content[0].text : ""}`
				: typeOf(delivery),
		);
		expect(shown).toEqual(["agent_start", "call-2:other", "message_update", "call-1:third"]);
	});

	test("past the pause bound pauses the transport while nothing awaits an answer, and resumes it once delivered", async () => {
		const gate = Promise.withResolvers<void>();
		const { transport } = opened(async (_client, delivery) => {
			if (typeOf(delivery) === "agent_start") await gate.promise;
		});
		transport.push({ type: "agent_start" });
		await Bun.sleep(0);
		transport.push(progress("call-1", "big", BIG));
		expect(transport.pauses).toEqual([true]);
		gate.resolve();
		await Bun.sleep(20);
		expect(transport.pauses).toEqual([true, false]);
	});
});
