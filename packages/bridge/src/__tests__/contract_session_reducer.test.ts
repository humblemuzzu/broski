import { describe, expect, test } from "bun:test";
import {
	type AgentEvent,
	applyEvent,
	emptySnapshot,
	type Interaction,
	MAX_RUN_ITEMS,
	MAX_TEXT_CHARS,
	SessionSnapshot,
	sessionStatus,
} from "../contract";

const UUID = "00000000-0000-4000-8000-000000000001";

function reduce(events: AgentEvent[], from: SessionSnapshot = emptySnapshot()): SessionSnapshot {
	return events.reduce((snapshot, event, index) => applyEvent(snapshot, { at: 100 + index, event }), from);
}

const ask = (id: string, blocksRun: boolean): Interaction => ({
	id,
	runId: "r1",
	createdAt: 1,
	title: "Allow?",
	blocksRun,
	request: { kind: "confirm" },
});

describe("applyEvent", () => {
	test("a run is live from run_started to run_finished, which records the outcome", () => {
		const running = reduce([{ type: "run_started", runId: "r1", trigger: "prompt" }]);
		expect(running.run).toEqual({ runId: "r1", trigger: "prompt", startedAt: 100, items: [], droppedItems: 0 });
		const done = reduce([{ type: "run_finished", runId: "r1", outcome: { kind: "completed" } }], running);
		expect(done.run).toBeUndefined();
		expect(done.lastOutcome).toEqual({ kind: "completed" });
	});

	test("a block accumulates its deltas and leaves when it finishes", () => {
		const open = reduce([
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text", parentToolCallId: "t1" },
			{ type: "block_delta", blockId: "b1", text: "Hel" },
			{ type: "block_delta", blockId: "b1", text: "lo" },
		]);
		expect(open.blocks).toEqual([
			{ blockId: "b1", messageId: "m1", kind: "text", parentToolCallId: "t1", text: "Hello" },
		]);
		expect(reduce([{ type: "block_finished", blockId: "b1", text: "Hello" }], open).blocks).toEqual([]);
	});

	test("a running tool gathers input, output, progress, file changes and its child session", () => {
		const changes = [{ path: "a.ts", change: "modified" as const }];
		const tool = reduce([
			{ type: "tool_started", toolCallId: "t1", name: "edit", messageId: "m1" },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "input", input: { path: "a.ts" } } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "one " } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "two" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "progress", message: "50%" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "file_changes", changes } },
			{
				type: "tool_updated",
				toolCallId: "t1",
				update: { kind: "child_session", session: { backend: "pi", sessionId: "c" } },
			},
		]);
		expect(tool.tools).toEqual([
			{
				toolCallId: "t1",
				name: "edit",
				messageId: "m1",
				input: { path: "a.ts" },
				output: "one two",
				progress: "50%",
				fileChanges: changes,
				childSession: { backend: "pi", sessionId: "c" },
			},
		]);
		const replaced = reduce(
			[{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_replaced", text: "new" } }],
			tool,
		);
		expect(replaced.tools[0]?.output).toBe("new");
		const finished = reduce(
			[{ type: "tool_finished", toolCallId: "t1", outcome: "completed", result: { content: [], fileChanges: [] } }],
			tool,
		);
		expect(finished.tools).toEqual([]);
	});

	test("interactions are pending from request to resolution", () => {
		const pending = reduce([{ type: "interaction_requested", interaction: ask("i1", true) }]);
		expect(pending.interactions).toEqual([ask("i1", true)]);
		expect(
			reduce([{ type: "interaction_resolved", interactionId: "i1", reason: "answered" }], pending).interactions,
		).toEqual([]);
	});

	test("queue, usage, plan and model state are replaced whole", () => {
		const state = reduce([
			{ type: "queue_changed", items: [{ id: "q1", delivery: "queue", preview: "later" }] },
			{ type: "usage_updated", usage: { inputTokens: 5 } },
			{ type: "model_changed", modelId: "m", thinking: "high" },
			{ type: "model_changed", modelId: "n" },
		]);
		expect(state.queue).toEqual([{ id: "q1", delivery: "queue", preview: "later" }]);
		expect(state.usage).toEqual({ inputTokens: 5 });
		expect(state.modelId).toBe("n");
		expect(state.thinking).toBeUndefined();
	});

	test("compaction and retry are live until they finish", () => {
		const live = reduce([
			{ type: "compaction_started", trigger: "auto" },
			{ type: "retry_scheduled", attempt: 2, maxAttempts: 3, retryAt: 500, message: "overloaded" },
		]);
		expect(live.compaction).toEqual({ trigger: "auto", startedAt: 100 });
		expect(live.retry).toEqual({ attempt: 2, maxAttempts: 3, retryAt: 500, message: "overloaded" });
		const done = reduce(
			[
				{ type: "compaction_finished", outcome: { kind: "completed" } },
				{ type: "retry_finished", succeeded: true },
			],
			live,
		);
		expect(done.compaction).toBeUndefined();
		expect(done.retry).toBeUndefined();
	});

	test("a retraction drops the retracted messages' blocks and tool calls, open or finished", () => {
		const state = reduce([
			{ type: "run_started", runId: "r1", trigger: "prompt" },
			{ type: "block_started", blockId: "b0", messageId: "m1", kind: "text" },
			{ type: "block_finished", blockId: "b0", text: "gone" },
			{ type: "tool_started", toolCallId: "t0", name: "ls", messageId: "m1" },
			{ type: "tool_finished", toolCallId: "t0", outcome: "completed", result: { content: [], fileChanges: [] } },
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "tool_started", toolCallId: "t1", name: "cat", messageId: "m1" },
			{ type: "block_started", blockId: "b2", messageId: "m2", kind: "text" },
			{ type: "messages_retracted", messageIds: ["m1"] },
		]);
		expect(state.blocks.map((block) => block.blockId)).toEqual(["b2"]);
		expect(state.tools).toEqual([]);
		expect(state.run?.items).toEqual([]);
	});

	test("the active run keeps what it finished, with the live ids, in order", () => {
		const state = reduce([
			{ type: "run_started", runId: "r1", trigger: "prompt" },
			{ type: "user_message", messageId: "u1", text: "go", attachments: [], clientRequestId: UUID },
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "block_delta", blockId: "b1", text: "Look" },
			{ type: "tool_started", toolCallId: "t1", name: "read", messageId: "m1" },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "input", input: { path: "a" } } },
			{ type: "block_finished", blockId: "b1", text: "Looking" },
			{ type: "tool_finished", toolCallId: "t1", outcome: "completed", result: { content: [], fileChanges: [] } },
		]);
		expect(state.run?.items).toEqual([
			{ kind: "user_message", id: "u1", at: 101, text: "go", attachments: [], clientRequestId: UUID },
			{ kind: "tool_call", id: "t1", at: 104, toolCallId: "t1", name: "read", messageId: "m1", input: { path: "a" } },
			{ kind: "block", id: "b1", at: 106, messageId: "m1", block: "text", text: "Looking" },
			{
				kind: "tool_result",
				id: "t1:result",
				at: 107,
				toolCallId: "t1",
				outcome: "completed",
				result: { content: [], fileChanges: [] },
			},
		]);
	});

	test("the active run drops its oldest items past the bound and counts them", () => {
		const messages: AgentEvent[] = Array.from({ length: MAX_RUN_ITEMS + 2 }, (_, index) => ({
			type: "user_message",
			messageId: `u${index}`,
			text: "more",
			attachments: [],
		}));
		const state = reduce([{ type: "run_started", runId: "r1", trigger: "prompt" }, ...messages]);
		expect(state.run?.items.length).toBe(MAX_RUN_ITEMS);
		expect(state.run?.droppedItems).toBe(2);
		expect(state.run?.items[0]).toMatchObject({ id: "u2" });
	});

	test("a replaced session starts its run's items afresh", () => {
		const state = reduce([
			{ type: "run_started", runId: "r1", trigger: "prompt" },
			{ type: "user_message", messageId: "u1", text: "go", attachments: [] },
			{ type: "session_replaced", session: { backend: "claude-code", sessionId: "next" } },
		]);
		expect(state.run?.items).toEqual([]);
	});

	test("a mode change replaces that mode's value in place", () => {
		const state = reduce(
			[
				{ type: "mode_changed", axis: "a", value: "2" },
				{ type: "mode_changed", axis: "c", value: "1" },
			],
			{
				...emptySnapshot(),
				modes: [
					{ axis: "a", value: "1" },
					{ axis: "b", value: "1" },
				],
			},
		);
		expect(state.modes).toEqual([
			{ axis: "a", value: "2" },
			{ axis: "b", value: "1" },
			{ axis: "c", value: "1" },
		]);
	});

	test("a running tool keeps the newest output past the bound, never half a character", () => {
		const tail = "x".repeat(MAX_TEXT_CHARS - 1);
		const state = reduce([
			{ type: "tool_started", toolCallId: "t1", name: "cat" },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: "a😀" } },
			{ type: "tool_updated", toolCallId: "t1", update: { kind: "output_appended", text: tail } },
		]);
		expect(state.tools[0]?.output).toBe(tail);
	});

	test("an open block keeps its newest text past the bound, never half a character, so the live state stays legal", () => {
		const tail = "y".repeat(MAX_TEXT_CHARS - 1);
		const state = reduce([
			{ type: "run_started", runId: "r1", trigger: "prompt" },
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "block_delta", blockId: "b1", text: "a😀" },
			{ type: "block_delta", blockId: "b1", text: tail },
		]);
		expect(state.blocks[0]?.text).toBe(tail);
		expect(SessionSnapshot.safeParse(state).success).toBe(true);
	});

	test("resynced replaces everything; notices, errors, extensions, user messages and a replacement change nothing", () => {
		const replacement: SessionSnapshot = { ...emptySnapshot(), modelId: "fresh" };
		const before = reduce([{ type: "run_started", runId: "r1", trigger: "prompt" }]);
		expect(reduce([{ type: "resynced", snapshot: replacement }], before)).toEqual(replacement);
		const unchanged = reduce(
			[
				{ type: "notice", level: "info", text: "hi" },
				{ type: "error", error: { code: "network", message: "x" }, retryable: true },
				{ type: "extension", extension: { kind: "rate_limit", window: "five_hour" } },
				{ type: "user_message", messageId: "u", text: "hi", attachments: [] },
				{ type: "session_replaced", session: { backend: "claude-code", sessionId: "next" } },
			],
			before,
		);
		expect(unchanged).toEqual(before);
	});
});

describe("sessionStatus", () => {
	test("follows the run and blocking asks", () => {
		expect(sessionStatus(emptySnapshot())).toBe("idle");
		const running = reduce([{ type: "run_started", runId: "r1", trigger: "prompt" }]);
		expect(sessionStatus(running)).toBe("running");
		expect(sessionStatus(reduce([{ type: "interaction_requested", interaction: ask("i1", false) }], running))).toBe(
			"running",
		);
		expect(sessionStatus(reduce([{ type: "interaction_requested", interaction: ask("i1", true) }], running))).toBe(
			"waiting_for_user",
		);
		const finished = reduce([{ type: "run_finished", runId: "r1", outcome: { kind: "completed" } }], running);
		expect(sessionStatus(finished)).toBe("idle");
	});
});
