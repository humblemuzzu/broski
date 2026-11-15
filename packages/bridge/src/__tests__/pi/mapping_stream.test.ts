/** one assistant message's stream. Pi's event shapes in, contract events out, checked by the contract's own stream rules. */

import { describe, expect, test } from "bun:test";
import { ToolCallIds } from "../../backends/pi/ids";
import { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import { toolFinished } from "../../backends/pi/mapping/tool-items";
import { PI_TRAITS } from "../../backends/pi/traits";
import {
	type AgentEvent,
	applyEvent,
	emptySnapshot,
	MAX_TEXT_CHARS,
	type SessionSnapshot,
	type SinkRecord,
} from "../../contract";
import { streamViolations, unsettledParts } from "../../contract/testing/stream-rules";
import { assistant, toolCall, validEvents } from "./mapping_fixtures";
import {
	callEnd,
	callStart,
	feed,
	inRun,
	streamEvent,
	textDelta,
	textEnd,
	textStart,
	thinkingDelta,
	thinkingEnd,
	thinkingStart,
	updateOf,
} from "./mapping_stream_events";

function fold(recordList: readonly SinkRecord[]): SessionSnapshot {
	return recordList.reduce((snapshot, record) => applyEvent(snapshot, record), emptySnapshot());
}

describe("a streamed message", () => {
	const tools = new ToolCallIds();
	const stream = new AssistantStream("msg-1", tools);
	const call = toolCall("call_9", "read", { path: "README.md" });
	const events = feed(stream, [
		streamEvent({ type: "start", partial: assistant([]) }),
		thinkingStart(0),
		thinkingDelta(0, "he"),
		thinkingDelta(0, "llo"),
		thinkingEnd(0, "hello"),
		textStart(1),
		textDelta(1, "Rea"),
		textDelta(1, "ding"),
		textEnd(1, "Reading"),
		callStart(
			2,
			assistant([{ type: "thinking", thinking: "" }, { type: "text", text: "" }, toolCall("call_9", "read")]),
		),
		streamEvent({ type: "toolcall_delta", contentIndex: 2, delta: '{"path":', partial: assistant([]) }),
		callEnd(2, call),
		streamEvent({ type: "done", reason: "toolUse", message: assistant([call], { stopReason: "toolUse" }) }),
	]);
	const closing = validEvents(
		stream.end(assistant([{ type: "thinking", thinking: "hello" }, { type: "text", text: "Reading" }, call])),
	);

	test("blocks are keyed by contentIndex under the message id, deltas between their start and finish", () => {
		expect(events).toEqual([
			{ type: "block_started", blockId: "msg-1:0", messageId: "msg-1", kind: "thinking" },
			{ type: "block_delta", blockId: "msg-1:0", text: "he" },
			{ type: "block_delta", blockId: "msg-1:0", text: "llo" },
			{ type: "block_finished", blockId: "msg-1:0", text: "hello" },
			{ type: "block_started", blockId: "msg-1:1", messageId: "msg-1", kind: "text" },
			{ type: "block_delta", blockId: "msg-1:1", text: "Rea" },
			{ type: "block_delta", blockId: "msg-1:1", text: "ding" },
			{ type: "block_finished", blockId: "msg-1:1", text: "Reading" },
			{ type: "tool_started", toolCallId: tools.liveId("call_9"), name: "read", messageId: "msg-1" },
			{
				type: "tool_updated",
				toolCallId: tools.liveId("call_9"),
				update: { kind: "input", input: { path: "README.md" } },
			},
		]);
	});

	test("message_end adds nothing when every block already finished", () => {
		expect(closing).toEqual([]);
	});

	test("the stream breaks no contract rule and leaves nothing open once its call finishes", () => {
		const recorded = inRun([...events, ...closing], tools, ["call_9"]);
		expect(streamViolations(recorded, PI_TRAITS, emptySnapshot())).toEqual([]);
		expect(unsettledParts(recorded, emptySnapshot())).toEqual([]);
	});

	test("applied to a snapshot, the finished blocks are the run's items under their live ids", () => {
		const mid = fold(inRun([...events, ...closing], tools).slice(0, -1));
		expect(mid.blocks).toEqual([]);
		expect(mid.tools).toMatchObject([{ name: "read", input: { path: "README.md" }, messageId: "msg-1" }]);
		expect(mid.run?.items).toMatchObject([
			{ kind: "block", id: "msg-1:0", block: "thinking", text: "hello" },
			{ kind: "block", id: "msg-1:1", block: "text", text: "Reading" },
			{ kind: "tool_call" },
		]);
	});
});

describe("tool calls", () => {
	test("a call whose id and name arrive late starts at toolcall_end, with its input", () => {
		const tools = new ToolCallIds();
		const stream = new AssistantStream("msg-1", tools);
		const events = feed(stream, [
			callStart(0, assistant([toolCall("", "")])),
			callEnd(0, toolCall("call_late", "bash", { command: "ls" })),
		]);
		expect(tools.find("call_late")).toBeDefined();
		const id = tools.liveId("call_late");
		expect(events).toEqual([
			{ type: "tool_started", toolCallId: id, name: "bash", messageId: "msg-1" },
			{ type: "tool_updated", toolCallId: id, update: { kind: "input", input: { command: "ls" } } },
		]);
		expect(streamViolations(inRun(events, tools, ["call_late"]), PI_TRAITS, emptySnapshot())).toEqual([]);
	});

	test("a start that names no call starts nothing", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		expect(updateOf(stream, callStart(3, assistant([])))).toEqual([]);
		expect(updateOf(stream, callStart(0, assistant([{ type: "text", text: "t" }])))).toEqual([]);
	});

	test("an invalid-arguments call still reports its (empty) input; the failure comes with its result", () => {
		const tools = new ToolCallIds();
		const stream = new AssistantStream("msg-1", tools);
		const bad = {
			...toolCall("call_bad", "read"),
			argumentsError: "Unexpected token\n\nReceived arguments:\n{oops",
		};
		const events = feed(stream, [callStart(0, assistant([toolCall("call_bad", "read")])), callEnd(0, bad)]);
		expect(events.at(-1)).toMatchObject({ update: { kind: "input", input: {} } });
	});

	test("the same provider call id in two responses of a run gives two live ids", () => {
		const tools = new ToolCallIds();
		const out: AgentEvent[] = [];
		for (const messageId of ["msg-1", "msg-2"]) {
			tools.nextResponse();
			const stream = new AssistantStream(messageId, tools);
			out.push(
				...feed(stream, [
					callStart(0, assistant([toolCall("call_1", "read")])),
					callEnd(0, toolCall("call_1", "read")),
				]),
			);
			out.push(toolFinished("call_1", "completed", { content: [], fileChanges: [] }, tools));
		}
		const ids = out.flatMap((event) => (event.type === "tool_started" ? [event.toolCallId] : []));
		expect(new Set(ids).size).toBe(2);
		expect(streamViolations(inRun(out, tools), PI_TRAITS, emptySnapshot())).toEqual([]);
	});

	test("two calls of one response that share a provider id are one call to the phone, not a repeated id", () => {
		const tools = new ToolCallIds();
		const stream = new AssistantStream("msg-1", tools);
		const events = feed(stream, [
			callEnd(0, toolCall("", "read", { path: "a" })),
			callEnd(1, toolCall("", "read", { path: "b" })),
		]);
		expect(events.filter((event) => event.type === "tool_started")).toHaveLength(1);
		expect(streamViolations(inRun(events, tools, [""]), PI_TRAITS, emptySnapshot())).toEqual([]);
	});

	test("a call with no name is shown under a placeholder, which the contract accepts", () => {
		const tools = new ToolCallIds();
		const stream = new AssistantStream("msg-1", tools);
		expect(feed(stream, [callEnd(0, toolCall("c", ""))])[0]).toMatchObject({ type: "tool_started", name: "unnamed" });
	});
});

describe("a block's finish is the stream rule's, not Pi's snapshot", () => {
	function streamed(deltas: string[], finalText: string): AgentEvent[] {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		return feed(stream, [
			thinkingStart(0),
			...deltas.map((delta) => thinkingDelta(0, delta)),
			thinkingEnd(0, finalText),
		]);
	}

	test("a final text that extends the deltas arrives as one last delta, then the finish", () => {
		expect(streamed(["a", "b"], "abcd").slice(-2)).toEqual([
			{ type: "block_delta", blockId: "msg-1:0", text: "cd" },
			{ type: "block_finished", blockId: "msg-1:0", text: "abcd" },
		]);
	});

	test("a final text that differs otherwise leaves the streamed text (OpenAI Responses drops a trailing \\n\\n)", () => {
		const events = streamed(["part one", "\n\n"], "part one");
		expect(events.at(-1)).toEqual({ type: "block_finished", blockId: "msg-1:0", text: "part one\n\n" });
		expect(streamViolations(inRun(events, new ToolCallIds()), PI_TRAITS, emptySnapshot())).toEqual([]);
	});

	test("a block that streamed no deltas finishes with the authoritative text", () => {
		expect(streamed([], "whole").at(-1)).toEqual({ type: "block_finished", blockId: "msg-1:0", text: "whole" });
	});

	test("deltas that together pass the bound finish with the newest text the snapshot would hold", () => {
		const half = "h".repeat(MAX_TEXT_CHARS / 2 + 10);
		const events = streamed([half, half], half + half);
		const finish = events.at(-1);
		expect(finish).toMatchObject({ type: "block_finished" });
		expect(finish?.type === "block_finished" && finish.text).toBe("h".repeat(MAX_TEXT_CHARS));
	});

	test("text past the bound is cut to it in a delta and in the finish", () => {
		const events = streamed(["y".repeat(MAX_TEXT_CHARS + 10)], "y".repeat(MAX_TEXT_CHARS + 10));
		expect(
			events.map((event) => (event.type === "block_delta" || event.type === "block_finished" ? event.text.length : 0)),
		).toEqual([0, MAX_TEXT_CHARS, MAX_TEXT_CHARS]);
	});
});

describe("end of a message", () => {
	test("a message the provider sent whole is started and finished at message_end; empty blocks are skipped", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		const events = validEvents(
			stream.end(
				assistant([
					{ type: "thinking", thinking: "plan", thinkingSignature: "s" },
					{ type: "text", text: "" },
					{ type: "text", text: "done" },
					toolCall("c", "read"),
					{ type: "thinking", thinking: "", thinkingSignature: "encrypted", redacted: true },
				]),
			),
		);
		expect(events).toEqual([
			{ type: "block_started", blockId: "msg-1:0", messageId: "msg-1", kind: "thinking" },
			{ type: "block_finished", blockId: "msg-1:0", text: "plan" },
			{ type: "block_started", blockId: "msg-1:2", messageId: "msg-1", kind: "text" },
			{ type: "block_finished", blockId: "msg-1:2", text: "done" },
		]);
	});

	test("a redacted thinking block arrives whole: started, then finished with Pi's placeholder text", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		const events = feed(stream, [thinkingStart(0), thinkingEnd(0, "[Reasoning redacted]")]);
		expect(events).toEqual([
			{ type: "block_started", blockId: "msg-1:0", messageId: "msg-1", kind: "thinking" },
			{ type: "block_finished", blockId: "msg-1:0", text: "[Reasoning redacted]" },
		]);
	});

	test("an open block is finished with the final message's text, which is truth", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		const opened = feed(stream, [textStart(0), textDelta(0, "par")]);
		expect(opened).toHaveLength(2);
		expect(stream.end(assistant([{ type: "text", text: "partial text" }], { stopReason: "error" }))).toEqual([
			{ type: "block_delta", blockId: "msg-1:0", text: "tial text" },
			{ type: "block_finished", blockId: "msg-1:0", text: "partial text" },
		]);
	});

	test("a block the final message no longer holds is still closed", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		feed(stream, [textStart(4), textDelta(4, "gone")]);
		expect(stream.end(assistant([]))).toEqual([{ type: "block_finished", blockId: "msg-1:4", text: "gone" }]);
	});

	test("abandon finishes what is open as it stands, once", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		feed(stream, [textStart(0), textDelta(0, "cut o"), thinkingStart(1)]);
		const events = validEvents(stream.abandon());
		expect(events).toEqual([
			{ type: "block_finished", blockId: "msg-1:0", text: "cut o" },
			{ type: "block_finished", blockId: "msg-1:1", text: "" },
		]);
		expect(stream.abandon()).toEqual([]);
		expect(stream.end(assistant([{ type: "text", text: "cut off" }]))).toEqual([]);
	});
});

describe("events Pi should not send, and the ones that carry nothing", () => {
	test("a repeated start, a delta for a block not open and an empty delta change nothing", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		expect(updateOf(stream, textDelta(0, "orphan"))).toEqual([]);
		expect(updateOf(stream, textStart(0))).toHaveLength(1);
		expect(updateOf(stream, textStart(0))).toEqual([]);
		expect(updateOf(stream, textDelta(0, ""))).toEqual([]);
		updateOf(stream, textEnd(0, ""));
		expect(updateOf(stream, textStart(0))).toEqual([]);
		expect(updateOf(stream, textDelta(0, "late"))).toEqual([]);
	});

	test("an end for a block never opened starts and finishes it, or does nothing when empty", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		expect(updateOf(stream, textEnd(0, ""))).toEqual([]);
		expect(feed(stream, [textEnd(1, "whole")])).toEqual([
			{ type: "block_started", blockId: "msg-1:1", messageId: "msg-1", kind: "text" },
			{ type: "block_finished", blockId: "msg-1:1", text: "whole" },
		]);
	});

	test("start, toolcall_delta, done and error are read as nothing", () => {
		const done = assistant([{ type: "text", text: "t" }]);
		const failed = assistant([], { stopReason: "error", errorMessage: "boom" });
		expect(streamEvent({ type: "start", partial: assistant([]) })).toEqual({ type: "ignored" });
		expect(streamEvent({ type: "toolcall_delta", contentIndex: 0, delta: "{", partial: assistant([]) })).toEqual({
			type: "ignored",
		});
		expect(streamEvent({ type: "done", reason: "stop", message: done })).toEqual({ type: "ignored" });
		expect(streamEvent({ type: "error", reason: "error", error: failed })).toEqual({ type: "ignored" });
	});
});

describe("a block that streams past the contract's bound", () => {
	test("keeps its newest text without copying all of it on every delta", () => {
		const stream = new AssistantStream("long", new ToolCallIds());
		updateOf(stream, textStart(0));
		updateOf(stream, textDelta(0, "x".repeat(MAX_TEXT_CHARS)));
		const updates = Array.from({ length: 20_000 }, () => textDelta(0, "a few words"));
		const began = performance.now();
		for (const update of updates) updateOf(stream, update);
		const took = performance.now() - began;
		const [finished] = stream.abandon();

		expect(took).toBeLessThan(200);
		expect(finished).toMatchObject({ type: "block_finished" });
		expect(finished?.type === "block_finished" && finished.text.length).toBe(MAX_TEXT_CHARS);
	});
});
