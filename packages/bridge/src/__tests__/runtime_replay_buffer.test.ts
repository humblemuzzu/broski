import { describe, expect, test } from "bun:test";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";
import type { ServerMessage } from "../types";
import { recordRuntimeEvent, replayRuntimeEventsSince } from "../utils/runtime-replay-buffer";

describe("Runtime replay buffer", () => {
	test("replays sequenced runtime events after a given seq", () => {
		const first: ServerMessage = {
			type: "runtime_event",
			backend: "opencode",
			data: {
				type: "assistant_text_delta",
				backend: "opencode",
				timestampMs: 1,
				sessionId: "oc-1",
				seq: 1,
				delta: "hello",
			},
		};
		const second: ServerMessage = {
			type: "runtime_event",
			backend: "opencode",
			data: {
				type: "assistant_text_delta",
				backend: "opencode",
				timestampMs: 2,
				sessionId: "oc-1",
				seq: 2,
				delta: " world",
			},
		};

		recordRuntimeEvent(first);
		recordRuntimeEvent(second);

		const replayed = replayRuntimeEventsSince({
			backend: "opencode",
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

	test("pi mapper exposes turn lifecycle as runtime lifecycle", () => {
		const started = mapPiStreamToRuntimeEvent(
			{ type: "turn-start" },
			{ backend: "pi", sessionId: "pi-1", cwd: "/tmp/repo" },
		);
		expect(started?.type).toBe("agent_started");
		expect(started?.sessionId).toBe("pi-1");
		expect(started?.seq).toBeDefined();

		const finished = mapPiStreamToRuntimeEvent(
			{
				type: "turn-end",
				message: { role: "assistant", content: "done" },
				toolResults: [],
			},
			{ backend: "pi", sessionId: "pi-1", cwd: "/tmp/repo" },
		);
		expect(finished?.type).toBe("agent_finished");
		expect(finished?.seq).toBeDefined();
	});
});
