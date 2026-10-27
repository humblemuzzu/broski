import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentEvent,
	CompactionResult,
	ConversationId,
	EntryId,
	SubmissionId,
	TaskId,
	UsageState,
} from "@earendil-works/pi-durable";
import { PiDurableEventBridge } from "../../runtime/pi-durable-partial-message";
import { mapDurableEventToBroski } from "../../runtime/pi-durable-runtime-event-mapper";
import { PI_DURABLE_CAPABILITIES, piDurableUsagePayload } from "../../runtime/pi-durable-runtime-read-models";
import type { BroskiRuntimeEvent } from "../../types/runtime";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "pi-durable-events.jsonl");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function readFixture(): AgentEvent[] {
	return readFileSync(FIXTURE, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as AgentEvent);
}

function contextOf(sessionId: string) {
	return { sessionId, cwd: "/tmp/pi-durable-project", timestampMs: 1_700_000_000_000 };
}

function eventsOfType<TType extends BroskiRuntimeEvent["type"]>(
	events: readonly BroskiRuntimeEvent[],
	type: TType,
): Extract<BroskiRuntimeEvent, { type: TType }>[] {
	return events.filter((event): event is Extract<BroskiRuntimeEvent, { type: TType }> => event.type === type);
}

function joinedDeltas(
	events: readonly BroskiRuntimeEvent[],
	type: "assistant_text_delta" | "assistant_thinking_delta",
) {
	return eventsOfType(events, type)
		.map((event) => event.delta)
		.join("");
}

describe("pi-durable event mapping", () => {
	test("reconstructs the captured answer byte-exact, without duplicating whole-block text", () => {
		const bridge = new PiDurableEventBridge();
		const mapped = bridge.absorb(readFixture(), contextOf("fixture"));
		const reconstructedText = bridge.reconstructed
			.filter((block) => block.kind === "text")
			.map((block) => block.text)
			.join("");

		expect(reconstructedText).toBe("DONE.");
		expect(joinedDeltas(mapped, "assistant_text_delta")).toBe("DONE.");
	});

	test("reconstructs the captured thinking of every turn", () => {
		const events = readFixture();
		const bridge = new PiDurableEventBridge();
		const mapped = bridge.absorb(events, contextOf("fixture"));

		const committed = events.flatMap((event) => {
			if (event.type !== "message_end") return [];
			const message = event.entry.model?.[0];
			if (message === undefined || message.role !== "assistant") return [];
			return message.content.flatMap((block) => (block.type === "thinking" ? [block.thinking] : []));
		});

		expect(committed.length).toBeGreaterThan(0);
		expect(joinedDeltas(mapped, "assistant_thinking_delta")).toBe(committed.join(""));
	});

	test("maps the captured tool round", () => {
		const bridge = new PiDurableEventBridge();
		const mapped = bridge.absorb(readFixture(), contextOf("fixture"));

		const started = eventsOfType(mapped, "tool_started");
		const finished = eventsOfType(mapped, "tool_finished");

		expect(started.map((event) => event.toolName)).toEqual(["read", "write"]);
		expect(finished.map((event) => event.toolName)).toEqual(["read", "write"]);
		expect(finished.map((event) => event.isError)).toEqual([false, false]);
		expect(finished.map((event) => event.backendData?.entryMissing)).toEqual([false, false]);
		expect(started.map((event) => event.input)).toEqual([
			{ path: "notes.txt" },
			{ path: "haiku.txt", content: "Platypus glides slow / Webbed feet through waters so blue / Ancient mammal egg" },
		]);
	});

	test("maps running tool output and diagnostics as tool_updated", () => {
		const mapped = mapDurableEventToBroski(
			{
				type: "tool_execution_update",
				toolCallId: "toolu_1",
				toolName: "bash",
				output: { set: "working\n" },
				details: { lines: 1 },
				diagnostics: [{ severity: "warn", message: "truncated", code: "bounds" }],
			},
			contextOf("tool-update"),
		);

		const update = eventsOfType(mapped, "tool_updated")[0];
		expect(update?.toolCallId).toBe("toolu_1");
		expect(update?.toolName).toBe("bash");
		expect(update?.partialOutput).toEqual({ set: "working\n" });
		expect(update?.backendData?.details).toEqual({ lines: 1 });
		expect(update?.backendData?.diagnostics).toEqual([{ severity: "warn", message: "truncated", code: "bounds" }]);
	});

	test("emits only the suffix when a whole block is re-sent", () => {
		const bridge = new PiDurableEventBridge();
		const update = (text: string) =>
			bridge.absorb(
				[
					{
						type: "message_update",
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: ZERO_COST },
						changes: [{ type: "block", contentIndex: 0, block: { type: "text", text } }],
					},
				],
				contextOf("whole-block"),
			);

		const first = update("DONE.");
		const repeated = update("DONE.");
		const grown = update("DONE. And more.");

		expect(joinedDeltas(first, "assistant_text_delta")).toBe("DONE.");
		expect(repeated).toEqual([]);
		expect(joinedDeltas(grown, "assistant_text_delta")).toBe(" And more.");
		expect(joinedDeltas([...first, ...repeated, ...grown], "assistant_text_delta")).toBe("DONE. And more.");
	});

	test("leaves message_update text to the event bridge", () => {
		const context = contextOf("bridge-owned");
		const update: AgentEvent = {
			type: "message_update",
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: ZERO_COST },
			changes: [{ type: "text_delta", contentIndex: 0, delta: "DONE." }],
		};

		expect(mapDurableEventToBroski(update, context)).toEqual([]);

		const bridge = new PiDurableEventBridge();
		expect(joinedDeltas(bridge.absorb([update], context), "assistant_text_delta")).toBe("DONE.");
	});

	test("carries a snapshot as a state change", () => {
		const mapped = mapDurableEventToBroski(
			{
				type: "snapshot",
				entries: [],
				tools: [{ callId: "call-1", name: "bash", status: "running", droppedBytes: 0, droppedLines: 2 }],
				nestedTools: [],
				compactions: [],
				inbox: [{ id: 42 as SubmissionId, mode: "steer" }],
				agent: {
					model: { provider: "anthropic", modelId: "claude-haiku-4-5" },
					thinkingLevel: "low",
					cwd: "/tmp/pi-durable-project",
				},
				usage: { models: {}, tools: {} },
			},
			contextOf("snapshot"),
		);

		const state = eventsOfType(mapped, "session_state_changed")[0];
		expect(state?.state.capabilities).toEqual(PI_DURABLE_CAPABILITIES);
		expect(state?.state.isStreaming).toBe(false);
		expect(state?.state.isCompacting).toBe(false);
		expect(state?.state.pendingMessageCount).toBe(1);
		expect(state?.state.model?.label).toBe("anthropic/claude-haiku-4-5");
		expect(state?.state.thinkingLevel).toBe("low");
		expect(state?.state.backendData?.tools).toEqual([
			{ callId: "call-1", name: "bash", status: "running", droppedBytes: 0, droppedLines: 2 },
		]);

		const running = mapDurableEventToBroski(
			{
				type: "snapshot",
				entries: [{ id: 7 as EntryId, conversationId: 1 as ConversationId, kind: "pi.user" }],
				run: { inputs: [8 as SubmissionId] },
				generation: { attempt: 2, retry: { at: 1, error: "boom" } },
				tools: [],
				nestedTools: [],
				compactions: [{ taskId: 3 as TaskId<CompactionResult>, reason: "threshold", blocking: true, attempt: 1 }],
				inbox: [],
				agent: {},
				usage: { models: {}, tools: {} },
			},
			contextOf("snapshot"),
		);
		const runningState = eventsOfType(running, "session_state_changed")[0];
		expect(runningState?.state.isStreaming).toBe(true);
		expect(runningState?.state.isRetrying).toBe(true);
		expect(runningState?.state.isCompacting).toBe(true);
		expect(runningState?.state.backendData?.lastEntryId).toBe(7);
	});

	test("carries inbox updates as a queue-update backend event", () => {
		const mapped = mapDurableEventToBroski(
			{ type: "inbox_update", items: [{ id: 42 as SubmissionId, mode: "steer" }] },
			contextOf("queue"),
		);

		const queue = eventsOfType(mapped, "backend_event")[0];
		expect(queue?.kind).toBe("queue-update");
		expect(queue?.payload).toEqual({ items: [{ id: 42, mode: "steer" }] });
	});

	test("mirrors run and turn boundaries as agent started/finished", () => {
		const context = contextOf("boundaries");
		expect(mapDurableEventToBroski({ type: "run_start", inputs: [1 as SubmissionId] }, context)[0]?.type).toBe(
			"agent_started",
		);
		expect(mapDurableEventToBroski({ type: "run_end", inputs: [1 as SubmissionId] }, context)[0]?.type).toBe(
			"agent_finished",
		);
		expect(mapDurableEventToBroski({ type: "turn_start" }, context)[0]?.type).toBe("agent_started");
		expect(mapDurableEventToBroski({ type: "turn_end" }, context)[0]?.type).toBe("agent_finished");
		expect(
			mapDurableEventToBroski(
				{ type: "message_end", entry: { id: 9 as EntryId, conversationId: 1 as ConversationId, kind: "pi.user" } },
				context,
			),
		).toEqual([]);
	});

	test("tags every emitted event with the pi-durable backend", () => {
		const bridge = new PiDurableEventBridge();
		const mapped = bridge.absorb(readFixture(), contextOf("backend"));
		expect(mapped.length).toBeGreaterThan(0);
		expect(mapped.every((event) => event.backend === "pi-durable")).toBe(true);
	});

	test("marks subscription usage as included in plan and hides the list price", () => {
		const usage: UsageState = {
			models: {
				"anthropic/claude-haiku-4-5": {
					input: 100,
					output: 20,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 120,
					cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
				},
			},
			tools: {},
		};

		const plan = piDurableUsagePayload(usage, { isSubscription: (providerId) => providerId === "anthropic" });
		expect(plan.models["anthropic/claude-haiku-4-5"]?.includedInPlan).toBe(true);
		expect(plan.models["anthropic/claude-haiku-4-5"]?.cost).toBeUndefined();
		expect(plan.models["anthropic/claude-haiku-4-5"]?.totalTokens).toBe(120);

		const apiKey = piDurableUsagePayload(usage, { isSubscription: () => false });
		expect(apiKey.models["anthropic/claude-haiku-4-5"]?.includedInPlan).toBe(false);
		expect(apiKey.models["anthropic/claude-haiku-4-5"]?.cost?.total).toBe(0.3);
	});
});
