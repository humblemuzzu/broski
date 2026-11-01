import { describe, expect, test } from "bun:test";
import type { ServerMessage } from "../types";
import { recordRuntimeEvent, replayRuntimeEventsSince } from "../utils/runtime-replay-buffer";

describe("Runtime replay buffer", () => {
	test("replays sequenced runtime events after a given seq", () => {
		const first: ServerMessage = {
			type: "runtime_event",
			backend: "claude-code",
			data: {
				type: "assistant_text_delta",
				backend: "claude-code",
				timestampMs: 1,
				sessionId: "oc-1",
				seq: 1,
				delta: "hello",
			},
		};
		const second: ServerMessage = {
			type: "runtime_event",
			backend: "claude-code",
			data: {
				type: "assistant_text_delta",
				backend: "claude-code",
				timestampMs: 2,
				sessionId: "oc-1",
				seq: 2,
				delta: " world",
			},
		};

		recordRuntimeEvent(first);
		recordRuntimeEvent(second);

		const replayed = replayRuntimeEventsSince({
			backend: "claude-code",
			sessionId: "oc-1",
			lastSeq: 1,
		});
		expect(replayed).toHaveLength(1);
		expect(replayed[0]).toMatchObject({
			type: "runtime_event",
			data: {
				seq: 2,
				replayed: true,
			},
		});
	});
});
