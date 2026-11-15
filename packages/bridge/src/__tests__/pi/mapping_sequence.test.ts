/**
 * one long run as Pi would drive it — a prompt, thinking and text, two tools (one failing), a
 * provider failure that is retried with a call left unstarted, a compaction, and an abort — mapped by
 * the mapping alone, folded with the contract's `applyEvent` and checked with its stream rules.
 */

import { describe, expect, test } from "bun:test";
import { ToolCallIds } from "../../backends/pi/ids";
import { runOutcome } from "../../backends/pi/mapping/errors";
import { userMessageEvent } from "../../backends/pi/mapping/message-items";
import {
	compactionFinished,
	compactionStarted,
	retryFinished,
	retryScheduled,
} from "../../backends/pi/mapping/session-events";
import { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import {
	toolFinished,
	toolOutcome,
	toolOutputOf,
	toolResultOf,
	toolStartedOfExecution,
} from "../../backends/pi/mapping/tool-items";
import { usageOf } from "../../backends/pi/mapping/usage";
import { PI_TRAITS } from "../../backends/pi/traits";
import { type AgentEvent, applyEvent, emptySnapshot, type SessionSnapshot, type SinkRecord } from "../../contract";
import { streamViolations, unsettledParts } from "../../contract/testing/stream-rules";
import { assistant, deepFreeze, piEvent, REQUEST_ID, records, toolCall, validEvents } from "./mapping_fixtures";
import {
	callEnd,
	callStart,
	feed,
	streamEvent,
	textDelta,
	textEnd,
	textStart,
	thinkingDelta,
	thinkingEnd,
	thinkingStart,
} from "./mapping_stream_events";

const NO_IMAGES = () => undefined;
const NOW = 1_700_000_000_000;

/** What the bridge records over the whole run, in the order Pi sends it. */
function run(): { events: AgentEvent[]; midway: AgentEvent[] } {
	const tools = new ToolCallIds();
	const out: AgentEvent[] = [];
	const emit = (events: readonly AgentEvent[]) => out.push(...validEvents(events));

	emit([{ type: "run_started", runId: "run-1", trigger: "prompt" }]);
	emit([userMessageEvent("read it and run ls", "u1", { clientRequestId: REQUEST_ID, imageNames: [] })]);

	// Response 1: thinking, text, then a read and a bash call, both of which Pi runs.
	tools.nextResponse();
	const first = new AssistantStream("msg-1", tools);
	const read = toolCall("call_read", "read", { path: "README.md" });
	const bash = toolCall("call_bash", "bash", { command: "ls missing" });
	emit(
		feed(first, [
			streamEvent({ type: "start", partial: assistant([]) }),
			thinkingStart(0),
			thinkingDelta(0, "plan"),
			thinkingEnd(0, "plan"),
			textStart(1),
			textDelta(1, "Let me look."),
			textEnd(1, "Let me look."),
			callStart(2, assistant([read])),
			callEnd(2, read),
			callStart(3, assistant([read, bash])),
			callEnd(3, bash),
		]),
	);
	const toolUse = assistant(
		[{ type: "thinking", thinking: "plan" }, { type: "text", text: "Let me look." }, read, bash],
		{ stopReason: "toolUse" },
	);
	emit(first.end(toolUse));
	for (const id of ["call_read", "call_bash"]) {
		const args = id === "call_read" ? read.arguments : bash.arguments;
		const name = id === "call_read" ? "read" : "bash";
		if (!tools.find(id))
			emit([
				toolStartedOfExecution(piEvent({ type: "tool_execution_start", toolCallId: id, toolName: name, args }), tools),
			]);
	}
	emit([
		toolOutputOf(
			piEvent({
				type: "tool_execution_update",
				toolCallId: "call_bash",
				toolName: "bash",
				args: bash.arguments,
				partialResult: { content: [{ type: "text", text: "\u001b[31mls: missing\u001b[0m" }] },
			}),
			tools,
		),
		toolFinished(
			"call_read",
			toolOutcome({ isError: false, denied: false, aborted: false }),
			toolResultOf([{ type: "text", text: "# Project" }], false, [], NO_IMAGES),
			tools,
		),
		toolFinished(
			"call_bash",
			toolOutcome({ isError: true, denied: false, aborted: false }),
			toolResultOf(
				[{ type: "text", text: "ls: missing: No such file\n\nCommand exited with code 1" }],
				true,
				[],
				NO_IMAGES,
			),
			tools,
		),
	]);

	// Response 2: the provider fails after a call started; Pi retries.
	tools.nextResponse();
	const second = new AssistantStream("msg-2", tools);
	const lost = toolCall("call_lost", "read", { path: "x" });
	emit(
		feed(second, [textStart(0), textDelta(0, "Now"), callStart(1, assistant([{ type: "text", text: "Now" }, lost]))]),
	);
	const overloaded = assistant([{ type: "text", text: "Now" }, lost], {
		stopReason: "error",
		errorMessage: "529 overloaded",
	});
	emit(second.end(overloaded));
	emit(
		second.unexecutedCalls(overloaded).map(
			(id): AgentEvent => ({
				type: "tool_finished",
				toolCallId: id,
				outcome: "aborted",
				result: { content: [], fileChanges: [] },
			}),
		),
	);
	emit([
		retryScheduled(
			{ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "529 overloaded" },
			NOW,
		),
	]);

	// Response 3 succeeds: the retry is over, then the context is compacted before the next turn.
	tools.nextResponse();
	const third = new AssistantStream("msg-3", tools);
	emit(
		feed(third, [
			textStart(0),
			textDelta(0, "Done: "),
			textDelta(0, "the README is short."),
			textEnd(0, "Done: the README is short."),
		]),
	);
	emit(third.end(assistant([{ type: "text", text: "Done: the README is short." }])));
	emit([retryFinished(piEvent({ type: "auto_retry_end", success: true, attempt: 1 }))]);
	emit([compactionStarted({ type: "compaction_start", reason: "threshold" })]);
	const midway = [...out];
	emit([
		compactionFinished(
			piEvent({
				type: "compaction_end",
				reason: "threshold",
				result: { summary: "s", firstKeptEntryId: "e1", tokensBefore: 9000, estimatedTokensAfter: 1000 },
				aborted: false,
				willRetry: false,
			}),
		),
	]);

	// Response 4 is cut off by the user's abort while a call is starting.
	tools.nextResponse();
	const fourth = new AssistantStream("msg-4", tools);
	const cut = toolCall("call_cut", "bash", { command: "sleep 9" });
	emit(
		feed(fourth, [
			thinkingStart(0),
			thinkingDelta(0, "wait"),
			callStart(1, assistant([{ type: "thinking", thinking: "wait" }, cut])),
		]),
	);
	const aborted = assistant([{ type: "thinking", thinking: "wait" }, cut], {
		stopReason: "aborted",
		errorMessage: "Request was aborted",
	});
	emit(fourth.end(aborted));
	emit(
		fourth.unexecutedCalls(aborted).map(
			(id): AgentEvent => ({
				type: "tool_finished",
				toolCallId: id,
				outcome: "aborted",
				result: { content: [], fileChanges: [] },
			}),
		),
	);

	emit([
		{
			type: "usage_updated",
			usage: usageOf({
				tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
				cost: 0.01,
				contextUsage: { tokens: 1200, contextWindow: 200_000 },
			}),
		},
		{ type: "run_finished", runId: "run-1", outcome: runOutcome(aborted, true) },
	]);
	return { events: out, midway };
}

function fold(recordList: readonly SinkRecord[]): SessionSnapshot {
	return recordList.reduce((snapshot, record) => applyEvent(snapshot, record), emptySnapshot());
}

describe("a long run", () => {
	const { events, midway } = run();
	const recorded = records(events);

	test("the stream breaks no rule and nothing is left open", () => {
		expect(streamViolations(recorded, PI_TRAITS, emptySnapshot())).toEqual([]);
		expect(unsettledParts(recorded, emptySnapshot())).toEqual([]);
	});

	test("every id in it is used once: blocks, tools", () => {
		const blocks = events.flatMap((event) => (event.type === "block_started" ? [event.blockId] : []));
		const calls = events.flatMap((event) => (event.type === "tool_started" ? [event.toolCallId] : []));
		expect(new Set(blocks).size).toBe(blocks.length);
		expect(new Set(calls).size).toBe(calls.length);
		expect(calls).toHaveLength(4);
	});

	test("folded, the run's items follow the events: a call when it starts, a block when it finishes, a result when the call does", () => {
		const before = fold(recorded.slice(0, -1));
		expect(before.run?.items.map((item) => item.kind)).toEqual([
			"user_message",
			"block",
			"block",
			"tool_call",
			"tool_call",
			"tool_result",
			"tool_result",
			"tool_call",
			"block",
			"tool_result",
			"block",
			"tool_call",
			"block",
			"tool_result",
		]);
		expect(before.blocks).toEqual([]);
		expect(before.tools).toEqual([]);
	});

	test("the failing tool is failed with its text as the error, the cut-off calls are aborted", () => {
		const finished = events.flatMap((event) => (event.type === "tool_finished" ? [event] : []));
		expect(finished.map((event) => event.outcome)).toEqual(["completed", "failed", "aborted", "aborted"]);
		expect(finished[1]?.result.error).toContain("Command exited with code 1");
		expect(finished[1]?.result.content).toEqual([]);
	});

	test("midway the compaction is under way and the retry is over", () => {
		const snapshot = fold(records(midway));
		expect(snapshot.compaction).toMatchObject({ trigger: "auto" });
		expect(snapshot.retry).toBeUndefined();
		expect(snapshot.run).toBeDefined();
	});

	test("at the end the run is over, aborted, with Pi's totals and the known context fill", () => {
		const snapshot = fold(recorded);
		expect(snapshot.run).toBeUndefined();
		expect(snapshot.lastOutcome).toEqual({ kind: "aborted" });
		expect(snapshot.compaction).toBeUndefined();
		expect(snapshot.usage).toEqual({
			inputTokens: 100,
			outputTokens: 50,
			cacheReadTokens: 10,
			cacheWriteTokens: 5,
			costUsd: 0.01,
			contextTokens: 1200,
			contextWindow: 200_000,
		});
	});

	test("Pi's inputs are not changed by being mapped: frozen messages go through", () => {
		const message = deepFreeze(
			assistant([toolCall("c", "read", { path: "p" })], { stopReason: "error", errorMessage: "x" }),
		);
		const stream = new AssistantStream("msg-9", new ToolCallIds());
		feed(stream, [callStart(0, message), callEnd(0, toolCall("c", "read", { path: "p" }))]);
		expect(stream.end(message)).toEqual([]);
		expect(stream.unexecutedCalls(message)).toHaveLength(1);
	});
});
