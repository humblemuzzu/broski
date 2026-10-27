/**
 * End-to-end streaming contract over a real bridge server: per-session delivery isolation, merged
 * delta seq ranges, reconnect replay, and Pi transcript paging against a synthetic session file.
 */

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { chain, header } from "../../bench/lib/pi-synthetic-sessions";
import { enrichRuntimeEvent } from "../runtime/stream-contract";
import type { BroskiRuntimeEvent } from "../types/runtime";
import {
	type BridgeHandle,
	connect,
	E2E_TEST_TIMEOUT_MS,
	E2E_WAIT_MS,
	type MessageCollector,
	send,
	setupTestEnv,
	sleep,
	startBridge,
	viewSession,
	writeJsonlSession,
} from "./e2e/harness";

setDefaultTimeout(E2E_TEST_TIMEOUT_MS);

const env = setupTestEnv();
let bridge: BridgeHandle;

beforeAll(
	async () => {
		bridge = await startBridge();
	},
	{ timeout: E2E_TEST_TIMEOUT_MS },
);

afterAll(async () => {
	await bridge.stop();
	env.restore();
});

function broadcastDelta(sessionId: string, text: string, seq?: number, streamId = "s"): void {
	const event: BroskiRuntimeEvent = {
		type: "assistant_text_delta",
		backend: "pi",
		timestampMs: Date.now(),
		sessionId,
		streamId,
		delta: text,
		...(seq === undefined ? {} : { seq }),
	};
	bridge.server.broadcast({ type: "runtime_event", backend: "pi", data: event });
}

function broadcastEnriched(sessionId: string, delta: string, streamId: string, cwd: string): void {
	const event = enrichRuntimeEvent(
		{ type: "assistant_text_delta", backend: "pi", timestampMs: Date.now(), sessionId, streamId, delta },
		{ backend: "pi", sessionId, cwd },
	);
	bridge.server.broadcast({ type: "runtime_event", backend: "pi", data: event });
}

function deltasOf(messages: MessageCollector): Array<{ delta: string; seq?: number; seqStart?: number }> {
	const out: Array<{ delta: string; seq?: number; seqStart?: number }> = [];
	for (const frame of messages.ofType("runtime_event")) {
		const data = frame.data as Record<string, unknown>;
		if (data.type !== "assistant_text_delta") continue;
		out.push({
			delta: String(data.delta ?? ""),
			...(typeof data.seq === "number" ? { seq: data.seq } : {}),
			...(typeof data.seqStart === "number" ? { seqStart: data.seqStart } : {}),
		});
	}
	return out;
}

async function waitForChars(messages: MessageCollector, target: number, timeoutMs = E2E_WAIT_MS): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (deltasOf(messages).reduce((sum, d) => sum + d.delta.length, 0) >= target) return;
		await sleep(20);
	}
}

describe("e2e per-session delivery", () => {
	test("a text delta reaches only the socket viewing that session", async () => {
		const a = await connect(bridge.port, bridge.token);
		const b = await connect(bridge.port, bridge.token);
		try {
			await viewSession(a.ws, a.messages, "pi", "iso-a");
			await viewSession(b.ws, b.messages, "pi", "iso-b");

			broadcastDelta("iso-a", "for-a");
			broadcastDelta("iso-b", "for-b");
			await sleep(60);

			expect(deltasOf(a.messages).map((d) => d.delta)).toEqual(["for-a"]);
			expect(deltasOf(b.messages).map((d) => d.delta)).toEqual(["for-b"]);
		} finally {
			a.ws.close();
			b.ws.close();
		}
	});

	test("cross-session activity reaches every socket, stripped of seq", async () => {
		const a = await connect(bridge.port, bridge.token);
		const b = await connect(bridge.port, bridge.token);
		try {
			await viewSession(a.ws, a.messages, "pi", "iso-c");
			await b.messages.waitFor("status");

			bridge.server.broadcast({
				type: "runtime_event",
				backend: "pi",
				data: { type: "agent_started", backend: "pi", timestampMs: Date.now(), sessionId: "iso-d", seq: 7 },
			});
			await sleep(60);

			const forA = await a.messages.waitFor("runtime_event");
			const forB = await b.messages.waitFor("runtime_event");
			expect((forA.data as Record<string, unknown>).type).toBe("agent_started");
			expect((forB.data as Record<string, unknown>).type).toBe("agent_started");
			expect((forA.data as Record<string, unknown>).seq).toBeUndefined();
		} finally {
			a.ws.close();
			b.ws.close();
		}
	});
});

describe("e2e merged delta seq ranges", () => {
	test("merged frames cover the whole seq range with no gap", async () => {
		const client = await connect(bridge.port, bridge.token);
		try {
			await viewSession(client.ws, client.messages, "pi", "seq-session");

			const count = 600;
			for (let i = 0; i < count; i += 1) {
				broadcastEnriched("seq-session", "x".repeat(120), "seq-stream", "/tmp/e2e-seq");
			}
			await waitForChars(client.messages, count * 120);

			const ranges = deltasOf(client.messages).map((d) => [d.seqStart ?? d.seq ?? -1, d.seq ?? -1] as const);
			expect(ranges.length).toBeGreaterThan(1);
			ranges.sort((a, b) => a[0] - b[0]);
			let expected = 1;
			for (const [start, end] of ranges) {
				expect(start).toBe(expected);
				expect(end).toBeGreaterThanOrEqual(start);
				expected = end + 1;
			}
			expect(expected - 1).toBe(count);
		} finally {
			client.ws.close();
		}
	});
});

describe("e2e reconnect replay", () => {
	test("set_view with lastRuntimeSeq replays the recorded frames unchanged", async () => {
		const first = await connect(bridge.port, bridge.token);
		try {
			await viewSession(first.ws, first.messages, "pi", "replay-session");

			for (let i = 0; i < 40; i += 1) {
				broadcastEnriched("replay-session", `chunk-${i}`, "replay-stream", "/tmp/e2e-replay");
			}
			await waitForChars(first.messages, 40 * "chunk-0".length);
			const live = deltasOf(first.messages);
			expect(live.length).toBeGreaterThan(0);

			const replay = await connect(bridge.port, bridge.token);
			try {
				await replay.messages.waitFor("status");
				replay.messages.clear();
				send(replay.ws, { type: "set_view", agent: "pi", sessionId: "replay-session", lastRuntimeSeq: 0 });
				const replayed = await replay.messages.waitForWhere(
					(m) => m.type === "runtime_event" && (m.data as Record<string, unknown>).replayed === true,
					"replayed runtime event",
				);
				const data = replayed.data as Record<string, unknown>;
				// A replay that re-ran the mapper would hand out a fresh seq, so the replayed frame
				// would not match the one the live socket saw.
				expect(live.some((d) => d.seq === data.seq && d.delta === data.delta)).toBe(true);
			} finally {
				replay.ws.close();
			}
		} finally {
			first.ws.close();
		}
	});
});

describe("e2e Pi transcript paging", () => {
	test("pages the newest messages backwards and joins into the whole read", async () => {
		const sessionPath = writeJsonlSession(join(env.home, "synthetic-sessions"), "session-page.jsonl", [
			header(3),
			...chain(8, "page"),
		]);

		const client = await connect(bridge.port, bridge.token);
		try {
			await client.messages.waitFor("status");
			client.messages.clear();

			send(client.ws, { type: "pi_read_session_messages", sessionPath, requestId: "whole" });
			const whole = await client.messages.waitFor("pi_session_messages");
			const wholeMessages = whole.data as Array<Record<string, unknown>>;
			expect(wholeMessages.length).toBeGreaterThan(2);

			client.messages.clear();
			send(client.ws, { type: "pi_read_session_messages", sessionPath, limit: 2, requestId: "page-1" });
			const page1 = await client.messages.waitFor("pi_session_messages");
			const page1Messages = page1.data as Array<Record<string, unknown>>;
			// A page is at least `limit` and reaches back to the prompt that opened its oldest turn.
			expect(page1Messages.length).toBeGreaterThanOrEqual(2);
			expect(page1Messages[0]?.role).toBe("user");
			expect(page1.hasMore).toBe(true);
			expect(typeof page1.nextCursor).toBe("string");

			client.messages.clear();
			send(client.ws, {
				type: "pi_read_session_messages",
				sessionPath,
				limit: 2,
				before: page1.nextCursor,
				requestId: "page-2",
			});
			const page2 = await client.messages.waitFor("pi_session_messages");
			const page2Messages = page2.data as Array<Record<string, unknown>>;

			const text = (m: Record<string, unknown>) => m.text ?? m.content;
			const walked = [...page2Messages, ...page1Messages].map(text);
			expect(walked).toEqual(wholeMessages.slice(-walked.length).map(text));
		} finally {
			client.ws.close();
		}
	});
});
