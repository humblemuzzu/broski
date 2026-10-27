import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { translateEvent } from "../connectors/pi/pi-events";
import { mapPiStreamToRuntimeEvent } from "../runtime/pi-runtime-event-mapper";

const ctx = { backend: "pi" as const, sessionId: "session-1", cwd: "/tmp" };

describe("pi event translation", () => {
	test("maps bash_execution_update to a bash-output stream message", () => {
		expect(translateEvent({ type: "bash_execution_update", id: "bash-1", delta: "hello\n" })).toEqual({
			type: "bash-output",
			content: "hello\n",
		});
	});

	test("maps the session lifecycle events added in SDK 1.1.0", () => {
		expect(translateEvent({ type: "agent_settled", aborted: true })).toEqual({ type: "agent-settled", aborted: true });
		expect(translateEvent({ type: "queue_update", steering: ["s"], followUp: ["f"] })).toEqual({
			type: "queue-update",
			steering: ["s"],
			followUp: ["f"],
		});
		expect(translateEvent({ type: "thinking_level_changed", level: "high" })).toEqual({
			type: "thinking-level-changed",
			level: "high",
		});
		expect(translateEvent({ type: "session_info_changed", name: "renamed" })).toEqual({
			type: "session-info-changed",
			name: "renamed",
		});
		expect(
			translateEvent({
				type: "summarization_retry_scheduled",
				attempt: 2,
				maxAttempts: 3,
				delayMs: 100,
				errorMessage: "boom",
			}),
		).toEqual({
			type: "summarization-retry-scheduled",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 100,
			errorMessage: "boom",
		});
		expect(translateEvent({ type: "summarization_retry_finished" })).toEqual({ type: "summarization-retry-finished" });
	});

	test("drops agent_end while the SDK will retry the turn", () => {
		expect(translateEvent({ type: "agent_end", messages: [], willRetry: true })).toBeNull();
		expect(translateEvent({ type: "agent_end", messages: [], willRetry: false })).toEqual({
			type: "agent-end",
			messages: [],
		});
	});

	test("never surfaces system-role messages as chat messages", () => {
		const system: AgentSessionEvent = {
			type: "message_end",
			message: { role: "system", content: "hidden", timestamp: 1 },
		};
		expect(translateEvent(system)).toBeNull();

		const turn: AgentSessionEvent = {
			type: "turn_end",
			message: { role: "system", content: "hidden", timestamp: 1 },
			toolResults: [],
		};
		expect(translateEvent(turn)).toBeNull();
	});
});

describe("pi runtime event mapping", () => {
	test("queue-update becomes a backend_event with kind queue-update", () => {
		const event = mapPiStreamToRuntimeEvent({ type: "queue-update", steering: ["s"], followUp: ["f"] }, ctx);
		expect(event?.type).toBe("backend_event");
		expect(event && "kind" in event ? event.kind : null).toBe("queue-update");
	});

	test("bash-output becomes a backend_event with kind bash-output", () => {
		const event = mapPiStreamToRuntimeEvent({ type: "bash-output", content: "chunk" }, ctx);
		expect(event?.type).toBe("backend_event");
		expect(event && "kind" in event ? event.kind : null).toBe("bash-output");
	});

	test("agent-end finishes the agent", () => {
		const event = mapPiStreamToRuntimeEvent({ type: "agent-end", messages: [] }, ctx);
		expect(event?.type).toBe("agent_finished");
		expect(event?.sessionId).toBe("session-1");
	});

	test("a model round trip inside one agent run does not start or finish the agent", () => {
		expect(mapPiStreamToRuntimeEvent({ type: "turn-start" }, ctx)).toBeNull();
		expect(mapPiStreamToRuntimeEvent({ type: "turn-end", message: {}, toolResults: [] }, ctx)).toBeNull();
	});

	test("agent-settled repeats agent-end, so it adds no second finish", () => {
		expect(mapPiStreamToRuntimeEvent({ type: "agent-settled", aborted: false }, ctx)).toBeNull();
	});
});
