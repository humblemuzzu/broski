import { describe, expect, test } from "bun:test";
import { type AgentEvent, type BackendTraits, emptySnapshot, type SessionSnapshot } from "../contract";
import { FULL_TRAITS, MINIMAL_TRAITS } from "../contract/testing/fake-data";
import { streamViolations, unsettledParts } from "../contract/testing/stream-rules";

function violations(events: AgentEvent[], traits: BackendTraits = FULL_TRAITS): string[] {
	return streamViolations(
		events.map((event, index) => ({ at: index, event })),
		traits,
		emptySnapshot(),
	);
}

const start: AgentEvent = { type: "run_started", runId: "r1", trigger: "prompt" };
const finish: AgentEvent = { type: "run_finished", runId: "r1", outcome: { kind: "completed" } };

describe("streamViolations", () => {
	test("a well-formed run has none and is at rest", () => {
		const events: AgentEvent[] = [
			start,
			{ type: "block_started", blockId: "b1", messageId: "m1", kind: "text" },
			{ type: "block_delta", blockId: "b1", text: "Hi" },
			{ type: "block_finished", blockId: "b1", text: "Hi" },
			{ type: "tool_started", toolCallId: "t1", name: "ls" },
			{ type: "tool_started", toolCallId: "t2", name: "cat", parentToolCallId: "t1" },
			{ type: "tool_finished", toolCallId: "t2", outcome: "completed", result: { content: [], fileChanges: [] } },
			{ type: "tool_finished", toolCallId: "t1", outcome: "completed", result: { content: [], fileChanges: [] } },
			finish,
		];
		expect(violations(events)).toEqual([]);
		expect(
			unsettledParts(
				events.map((event, index) => ({ at: index, event })),
				emptySnapshot(),
			),
		).toEqual([]);
	});

	test("run brackets must pair", () => {
		expect(violations([start, start])).toEqual([expect.stringContaining("while run r1 is active")]);
		expect(violations([finish])).toEqual([expect.stringContaining("the active run is none")]);
	});

	test("blocks and tools live inside a run and finish before it", () => {
		expect(violations([{ type: "block_started", blockId: "b", messageId: "m", kind: "text" }])).toEqual([
			expect.stringContaining("a block outside a run"),
		]);
		expect(violations([start, { type: "tool_started", toolCallId: "t", name: "x" }, finish])).toEqual([
			expect.stringContaining("tools still running: t"),
		]);
		expect(violations([start, { type: "block_delta", blockId: "b", text: "x" }])).toEqual([
			expect.stringContaining("block b is not open"),
		]);
	});

	test("an activity lives inside a run, and ends before it", () => {
		const running: AgentEvent = { type: "activity", activity: { id: "h1", label: "Stop", status: "running" } };
		const done: AgentEvent = { type: "activity", activity: { id: "h1", label: "Stop", status: "succeeded" } };
		expect(violations([running])).toEqual(["#0 activity: an activity outside a run"]);
		expect(violations([start, running, done, finish])).toEqual([]);
		expect(violations([start, running, finish])).toEqual(["#2 run_finished: activities still running: h1"]);
		const records = [start, running].map((event, index) => ({ at: index, event }));
		expect(unsettledParts(records, emptySnapshot())).toContain("activity h1 never ended");
		const held: SessionSnapshot = {
			...emptySnapshot(),
			run: {
				runId: "r1",
				trigger: "prompt",
				startedAt: 0,
				items: [{ kind: "activity", id: "h1", label: "Stop", status: "running" }],
				droppedItems: 0,
			},
		};
		expect(streamViolations([{ at: 0, event: finish }], FULL_TRAITS, held)).toEqual([
			"#0 run_finished: activities still running: h1",
		]);
	});

	test("a finished block must equal its deltas", () => {
		expect(
			violations([
				start,
				{ type: "block_started", blockId: "b", messageId: "m", kind: "text" },
				{ type: "block_delta", blockId: "b", text: "a" },
				{ type: "block_finished", blockId: "b", text: "b" },
			]),
		).toEqual([expect.stringContaining("differs from the deltas")]);
	});

	test("a nested tool names a running parent", () => {
		expect(violations([start, { type: "tool_started", toolCallId: "t", name: "x", parentToolCallId: "p" }])).toEqual([
			expect.stringContaining("parent tool p is not running"),
		]);
	});

	test("an interaction resolves exactly once, and only if it was requested", () => {
		const requested: AgentEvent = {
			type: "interaction_requested",
			interaction: { id: "i", runId: "r1", createdAt: 1, title: "?", blocksRun: true, request: { kind: "confirm" } },
		};
		const resolved: AgentEvent = { type: "interaction_resolved", interactionId: "i", reason: "answered" };
		expect(violations([start, requested, resolved, resolved])).toEqual([expect.stringContaining("resolved twice")]);
		expect(violations([start, resolved])).toEqual([expect.stringContaining("never requested")]);
		expect(violations([start, requested, finish])).toEqual([expect.stringContaining("still pending: i")]);
	});

	test("events of a capability the traits deny are violations", () => {
		const undeclared: AgentEvent[] = [
			start,
			{ type: "block_started", blockId: "b", messageId: "m", kind: "thinking" },
			{ type: "block_delta", blockId: "b", text: "x" },
			{ type: "queue_changed", items: [] },
			{ type: "usage_updated", usage: {} },
			{ type: "plan_updated", plan: { items: [] } },
			{ type: "extension", extension: { kind: "rate_limit", window: "five_hour" } },
		];
		expect(violations(undeclared, MINIMAL_TRAITS)).toEqual([
			expect.stringContaining("thinking deltas"),
			expect.stringContaining("a queue from a backend without one"),
			expect.stringContaining("usage from a backend"),
			expect.stringContaining("a plan from a backend"),
			expect.stringContaining("undeclared extension rate_limit"),
		]);
	});

	test("a retry or compaction finishes only after it started", () => {
		expect(violations([start, { type: "retry_finished", succeeded: true }])).toEqual([
			expect.stringContaining("never started"),
		]);
		expect(violations([{ type: "compaction_finished", outcome: { kind: "aborted" } }])).toEqual([
			expect.stringContaining("never started"),
		]);
	});

	test("resynced resets what the checker knows", () => {
		const resynced: AgentEvent = { type: "resynced", snapshot: emptySnapshot() };
		expect(violations([start, { type: "tool_started", toolCallId: "t", name: "x" }, resynced])).toEqual([]);
	});

	test("ids open or finished in the starting snapshot, or seen before a resync, are never reused", () => {
		const running: SessionSnapshot = {
			...emptySnapshot(),
			run: {
				runId: "r1",
				trigger: "prompt",
				startedAt: 1,
				items: [{ kind: "block", id: "done", messageId: "m", block: "text", text: "x" }],
				droppedItems: 0,
			},
			blocks: [{ blockId: "open", messageId: "m", kind: "text", text: "" }],
		};
		const records = (events: AgentEvent[]) => events.map((event, index) => ({ at: index, event }));
		const reuse: AgentEvent[] = [
			{ type: "block_finished", blockId: "open", text: "" },
			{ type: "block_started", blockId: "open", messageId: "m", kind: "text" },
			{ type: "block_started", blockId: "done", messageId: "m", kind: "text" },
		];
		expect(streamViolations(records(reuse), FULL_TRAITS, running)).toEqual([
			expect.stringContaining("block id open reused"),
			expect.stringContaining("block id done reused"),
		]);
		const afterResync: AgentEvent[] = [
			start,
			{ type: "tool_started", toolCallId: "t", name: "x" },
			{ type: "resynced", snapshot: emptySnapshot() },
			{ type: "run_started", runId: "r2", trigger: "prompt" },
			{ type: "tool_started", toolCallId: "t", name: "x" },
		];
		expect(violations(afterResync)).toEqual([expect.stringContaining("tool call id t reused")]);
	});

	test("a run does not finish while a compaction is under way, and a compaction does not start twice", () => {
		const compacting: AgentEvent = { type: "compaction_started", trigger: "auto" };
		expect(violations([start, compacting, finish])).toEqual([expect.stringContaining("compaction is still under way")]);
		expect(violations([compacting, compacting])).toEqual([expect.stringContaining("while one is under way")]);
	});

	test("an unfinished compaction or retry leaves the stream unsettled", () => {
		const events: AgentEvent[] = [
			{ type: "compaction_started", trigger: "manual" },
			start,
			{ type: "retry_scheduled", attempt: 1, message: "busy" },
		];
		expect(
			unsettledParts(
				events.map((event, index) => ({ at: index, event })),
				emptySnapshot(),
			),
		).toEqual(["run r1 never finished", "a compaction never finished", "a retry never finished"]);
	});

	test("a blocking interaction names its run", () => {
		const outside: AgentEvent = {
			type: "interaction_requested",
			interaction: { id: "i", createdAt: 1, title: "?", blocksRun: true, request: { kind: "confirm" } },
		};
		expect(violations([start, outside])).toEqual([expect.stringContaining("names no run")]);
	});

	test("an invalid record is reported", () => {
		const broken = streamViolations([{ at: -1, event: start }], FULL_TRAITS, emptySnapshot());
		expect(broken).toEqual([expect.stringContaining("not a valid record")]);
	});
});
