/** calls the stream started that Pi will never run. */

import { describe, expect, test } from "bun:test";
import { ToolCallIds } from "../../backends/pi/ids";
import { AssistantStream } from "../../backends/pi/mapping/stream-blocks";
import { PI_TRAITS } from "../../backends/pi/traits";
import { type AgentEvent, emptySnapshot } from "../../contract";
import { streamViolations, unsettledParts } from "../../contract/testing/stream-rules";
import { assistant, records, toolCall } from "./mapping_fixtures";
import { callEnd, callStart, feed } from "./mapping_stream_events";

describe("calls Pi will never run", () => {
	const read = toolCall("call_r", "read", { path: "a" });
	const bash = toolCall("call_b", "bash", { command: "ls" });

	function started(tools: ToolCallIds): { stream: AssistantStream; events: AgentEvent[] } {
		const stream = new AssistantStream("msg-1", tools);
		const events = feed(stream, [
			callStart(0, assistant([read])),
			callEnd(0, read),
			callStart(1, assistant([read, toolCall("call_b", "bash")])),
		]);
		return { stream, events };
	}

	test("a message that stopped in error or abort runs none of its calls, whether or not their arguments ended", () => {
		for (const stopReason of ["error", "aborted"] as const) {
			const tools = new ToolCallIds();
			const { stream } = started(tools);
			const message = assistant([read, bash], { stopReason });
			stream.end(message);
			expect(stream.unexecutedCalls(message)).toEqual([tools.liveId("call_r"), tools.liveId("call_b")]);
		}
	});

	test("a message that stopped to use its tools runs every call it holds, and only a started call it no longer holds is lost", () => {
		const tools = new ToolCallIds();
		const { stream } = started(tools);
		const both = assistant([read, bash], { stopReason: "toolUse" });
		stream.end(both);
		expect(stream.unexecutedCalls(both)).toEqual([]);
		const withoutBash = assistant([read], { stopReason: "toolUse" });
		expect(stream.unexecutedCalls(withoutBash)).toEqual([tools.liveId("call_b")]);
	});

	test("a call started at toolcall_end is counted the same way", () => {
		const tools = new ToolCallIds();
		const stream = new AssistantStream("msg-1", tools);
		feed(stream, [callStart(0, assistant([toolCall("", "")])), callEnd(0, read)]);
		expect(stream.unexecutedCalls(assistant([read], { stopReason: "error" }))).toEqual([tools.liveId("call_r")]);
		expect(stream.unexecutedCalls(assistant([read], { stopReason: "toolUse" }))).toEqual([]);
	});

	test("a stream that started no call reports none", () => {
		const stream = new AssistantStream("msg-1", new ToolCallIds());
		expect(stream.unexecutedCalls(assistant([read], { stopReason: "error" }))).toEqual([]);
	});

	test("finishing exactly those calls aborted leaves a stream that breaks no rule", () => {
		const tools = new ToolCallIds();
		const { stream, events } = started(tools);
		const message = assistant([read, bash], { stopReason: "error", errorMessage: "529 overloaded" });
		const closing = stream.end(message);
		const aborted = stream.unexecutedCalls(message).map(
			(id): AgentEvent => ({
				type: "tool_finished",
				toolCallId: id,
				outcome: "aborted",
				result: { content: [], fileChanges: [] },
			}),
		);
		const recorded = records([
			{ type: "run_started", runId: "run-1", trigger: "prompt" },
			...events,
			...closing,
			...aborted,
			{
				type: "run_finished",
				runId: "run-1",
				outcome: { kind: "error", error: { code: "server", message: "529 overloaded" } },
			},
		]);
		expect(streamViolations(recorded, PI_TRAITS, emptySnapshot())).toEqual([]);
		expect(unsettledParts(recorded, emptySnapshot())).toEqual([]);
	});
});
