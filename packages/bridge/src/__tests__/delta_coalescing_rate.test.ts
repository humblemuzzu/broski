/**
 * A model that streams one token every ~43 ms is the case the coalescer exists for: the old 4 ms
 * trailing window closed before the next token arrived, so every token cost a frame — 70 events for
 * a 70-word reply. Here the first token still goes out at once, and the rest are merged into frames
 * one cadence apart.
 */

import { describe, expect, test } from "bun:test";
import { RuntimeEventCoalescer } from "../transport/runtime-event-coalescer";
import type { ServerMessage } from "../types";
import type { BroskiRuntimeEvent } from "../types/runtime";

/** 70 deltas in 1.6 s is one every ~23 ms, which is the Pi reply this was measured on. */
const TOKEN_INTERVAL_MS = 23;
const TOKENS = 70;

function delta(text: string, seq: number): ServerMessage {
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
			delta: text,
		} satisfies BroskiRuntimeEvent,
	};
}

/** Streams [TOKENS] deltas at [TOKEN_INTERVAL_MS] and returns what came out, with the first frame's latency. */
async function streamReply(cadenceMs: number): Promise<{ frames: ServerMessage[]; firstFrameMs: number }> {
	const emitted: ServerMessage[] = [];
	const coalescer = new RuntimeEventCoalescer((message) => emitted.push(message), cadenceMs);
	const started = Date.now();
	let firstFrameMs = -1;
	for (let index = 0; index < TOKENS; index++) {
		coalescer.push(delta(`t${index} `, index + 1));
		if (firstFrameMs < 0 && emitted.length > 0) firstFrameMs = Date.now() - started;
		if (index < TOKENS - 1) await Bun.sleep(TOKEN_INTERVAL_MS);
	}
	// The last tokens are still inside the cadence window; a finished turn flushes them.
	coalescer.flushAll();
	return { frames: emitted, firstFrameMs };
}

function textOf(message: ServerMessage): string {
	if (message.type !== "runtime_event") return "";
	const data = message.data;
	return data.type === "assistant_text_delta" ? data.delta : "";
}

describe("a 70-token reply at ~23 tokens a second", () => {
	test("goes out as a fraction of the events, with no first-token delay", async () => {
		const perToken = await streamReply(0);
		const coalesced = await streamReply(45);

		// Per token: one frame each, which is what a 4 ms trailing window produced.
		expect(perToken.frames).toHaveLength(TOKENS);
		expect(perToken.frames.map(textOf).join("")).toBe(
			Array.from({ length: TOKENS }, (_, index) => `t${index} `).join(""),
		);

		// Two deltas per cadence window: 70 events become a few dozen frames.
		expect(coalesced.frames.length).toBeLessThan(TOKENS * 0.6);
		expect(coalesced.firstFrameMs).toBeLessThan(50);
		// Nothing is lost or reordered on the way: the frames still spell the reply.
		expect(coalesced.frames.map(textOf).join("")).toBe(perToken.frames.map(textOf).join(""));
	});

	test("every frame carries the seq range it stands for, so gaps stay exact", async () => {
		const { frames } = await streamReply(45);
		const ranges = frames.map((message) => {
			if (message.type !== "runtime_event" || message.data.type !== "assistant_text_delta") {
				throw new Error("expected a text delta");
			}
			return [message.data.seqStart ?? message.data.seq, message.data.seq] as const;
		});

		expect(ranges[0]![0]).toBe(1);
		expect(ranges[ranges.length - 1]![1]).toBe(TOKENS);
		for (let index = 1; index < ranges.length; index++) {
			expect(ranges[index]![0]).toBe(ranges[index - 1]![1]! + 1);
		}
	});
});
