/**
 * A runtime event too large for the link: its biggest payload strings are cut to fit, and an event
 * with nothing string-shaped to cut is reduced to its ids instead of being dropped.
 */

import { describe, expect, test } from "bun:test";
import type { ServerMessage } from "../types";
import { shrinkRuntimeEvent } from "../utils/truncate-runtime-event";

const LIMIT = 64 * 1024;

function event(data: Record<string, unknown>): Parameters<typeof shrinkRuntimeEvent>[0] {
	return {
		type: "runtime_event",
		backend: "claude-code",
		data: { backend: "claude-code", timestampMs: 7, sessionId: "sess-1", ...data },
	} as Parameters<typeof shrinkRuntimeEvent>[0];
}

function parse(frame: string) {
	return JSON.parse(frame) as {
		truncated?: boolean;
		data: { type?: string; sessionId?: string; toolCallId?: string; truncated?: boolean; output?: string };
	};
}

describe("shrinkRuntimeEvent", () => {
	test("cuts the largest string and marks it, keeping the ids", () => {
		const message = event({ type: "tool_finished", toolCallId: "call-1", output: "x".repeat(LIMIT * 2) });

		const frame = shrinkRuntimeEvent(message, LIMIT);
		const shrunk = parse(frame);

		expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(LIMIT);
		expect(shrunk.truncated).toBe(true);
		expect(shrunk.data.type).toBe("tool_finished");
		expect(shrunk.data.toolCallId).toBe("call-1");
		expect(shrunk.data.sessionId).toBe("sess-1");
		expect(shrunk.data.output).toContain("truncated by the bridge");
	});

	test("an event with nothing string-shaped to cut keeps only its ids", () => {
		const message = event({ type: "tool_updated", numbers: Array.from({ length: LIMIT }, (_, index) => index) });

		const frame = shrinkRuntimeEvent(message, LIMIT);
		const shrunk = parse(frame);

		expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(LIMIT);
		expect(shrunk.data.type).toBe("tool_updated");
		expect(shrunk.data.truncated).toBe(true);
		expect(shrunk.data).not.toHaveProperty("numbers");
	});

	test("an event that already fits is left alone", () => {
		const message = event({ type: "agent_finished" });
		expect(shrinkRuntimeEvent(message, LIMIT)).not.toContain("truncated");
	});
});
