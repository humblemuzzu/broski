/** Text and thinking blocks: ids, the two orders of an `assistant` frame and its `content_block_stop`, and what settles. */

import { describe, expect, test } from "bun:test";
import { MAX_TEXT_CHARS } from "../../../contract";
import {
	assistant,
	blockStart,
	blockStop,
	inputJsonDelta,
	messageStart,
	messageStop,
	text,
	textDelta,
	thinking,
	thinkingDelta,
	toolUse,
} from "./frames";
import { newMapper, ofType, play, shapeOf } from "./helpers";

const MSG = "msg_01abc";

function streamedText(value: string, order: "assistant-first" | "stop-first") {
	const tail =
		order === "assistant-first"
			? [assistant(MSG, [text(value)]), blockStop(0)]
			: [blockStop(0), assistant(MSG, [text(value)])];
	return [
		messageStart(MSG),
		blockStart(0, text("")),
		textDelta(0, value.slice(0, 2)),
		textDelta(0, value.slice(2)),
		...tail,
		messageStop(),
	];
}

describe("a streamed text block", () => {
	for (const order of ["assistant-first", "stop-first"] as const) {
		test(`${order}: one start, the deltas, one finish with the whole text`, () => {
			const events = play(streamedText("hello", order)).streams.get("");
			expect(shapeOf(events)).toBe(
				"run_started block_started:text block_delta*2 block_finished run_finished:completed",
			);
			expect(ofType(events, "block_started")[0]?.blockId).toBe(`${MSG}:0`);
			expect(ofType(events, "block_finished")[0]).toEqual({
				type: "block_finished",
				blockId: `${MSG}:0`,
				text: "hello",
			});
		});
	}

	test("the assistant frame's text is authoritative over what the deltas built", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, text("")),
			textDelta(0, "ab"),
			assistant(MSG, [text("abc")]),
			blockStop(0),
			messageStop(),
		]).streams.get("");
		expect(ofType(events, "block_finished")[0]?.text).toBe("abc");
	});

	test("a stream cut before any assistant frame finishes the block with its deltas at message_stop", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, text("")),
			textDelta(0, "par"),
			textDelta(0, "tial"),
			messageStop(),
		]).streams.get("");
		expect(ofType(events, "block_finished")).toEqual([
			{ type: "block_finished", blockId: `${MSG}:0`, text: "partial" },
		]);
	});

	test("an assistant frame that comes after message_stop does not start the block a second time", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, text("")),
			textDelta(0, "partial"),
			messageStop(),
			assistant(MSG, [text("partial")]),
		]).streams.get("");
		expect(ofType(events, "block_started")).toHaveLength(1);
		expect(ofType(events, "block_finished")).toHaveLength(1);
	});

	test("an assistant frame after the block finished adds nothing, and so does the same frame twice", () => {
		const frames = streamedText("hello", "stop-first");
		const events = play([...frames, ...frames.filter((frame) => frame.type === "assistant")]).streams.get("");
		expect(ofType(events, "block_finished")).toHaveLength(1);
		expect(ofType(events, "block_started")).toHaveLength(1);
	});

	test("an initial text on the block start is delivered as a delta", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, text("Hi")),
			assistant(MSG, [text("Hi")]),
			messageStop(),
		]).streams.get("");
		expect(shapeOf(events)).toBe("run_started block_started:text block_delta block_finished run_finished:completed");
	});
});

describe("blocks of one message", () => {
	test("thinking is block 0 and text block 1, each completed by its own assistant frame", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, thinking("")),
			thinkingDelta(0, "hm"),
			assistant(MSG, [thinking("hm")]),
			blockStop(0),
			blockStart(1, text("")),
			textDelta(1, "ok"),
			assistant(MSG, [text("ok")]),
			blockStop(1),
			messageStop(),
		]).streams.get("");
		expect(ofType(events, "block_started").map((event) => [event.blockId, event.kind])).toEqual([
			[`${MSG}:0`, "thinking"],
			[`${MSG}:1`, "text"],
		]);
		expect(ofType(events, "block_finished").map((event) => event.text)).toEqual(["hm", "ok"]);
	});

	test("a tool call between two texts is matched by its id, so the second text is block 2", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, text("")),
			textDelta(0, "a"),
			assistant(MSG, [text("a")]),
			blockStop(0),
			blockStart(1, toolUse("toolu_1", "Read", {})),
			inputJsonDelta(1, '{"file_path":'),
			assistant(MSG, [toolUse("toolu_1", "Read", { file_path: "x" })]),
			blockStop(1),
			blockStart(2, text("")),
			textDelta(2, "b"),
			assistant(MSG, [text("b")]),
			blockStop(2),
			messageStop(),
		]).streams.get("");
		expect(ofType(events, "block_started").map((event) => event.blockId)).toEqual([`${MSG}:0`, `${MSG}:2`]);
		expect(ofType(events, "tool_started")[0]?.input).toEqual({ file_path: "x" });
	});

	test("a block the stream announced but no frame shows (redacted thinking) still takes its index", () => {
		const events = play([
			messageStart(MSG),
			blockStart(0, { type: "redacted_thinking", data: "x" }),
			assistant(MSG, [{ type: "redacted_thinking", data: "x" }]),
			blockStop(0),
			blockStart(1, text("")),
			textDelta(1, "hi"),
			assistant(MSG, [text("hi")]),
			blockStop(1),
			messageStop(),
		]).streams.get("");
		expect(ofType(events, "block_started").map((event) => event.blockId)).toEqual([`${MSG}:1`]);
	});
});

describe("assistant frames nobody streamed", () => {
	test("start and finish at once, one index per block in arrival order", () => {
		const events = play([assistant(MSG, [thinking("why"), text("because")])]).streams.get("");
		expect(shapeOf(events)).toBe(
			"run_started block_started:thinking block_finished block_started:text block_finished run_finished:completed",
		);
		expect(ofType(events, "block_started").map((event) => event.blockId)).toEqual([`${MSG}:0`, `${MSG}:1`]);
	});

	test("an empty text block is not worth a block", () => {
		expect(shapeOf(play([assistant(MSG, [text("")])]).streams.get(""))).toBe("");
	});

	test("one message in several frames numbers its blocks 0, 1, 2", () => {
		const events = play([
			assistant(MSG, [text("a")]),
			assistant(MSG, [text("b")]),
			assistant(MSG, [text("c")]),
		]).streams.get("");
		expect(ofType(events, "block_started").map((event) => event.blockId)).toEqual([`${MSG}:0`, `${MSG}:1`, `${MSG}:2`]);
	});

	test("a frame delivered twice shows once", () => {
		const frame = assistant(MSG, [text("a")]);
		expect(ofType(play([frame, frame]).streams.get(""), "block_started")).toHaveLength(1);
	});

	test("a synthetic API error is a notice, not the model's block", () => {
		const events = play([assistant("err-1", [text("API Error: overloaded")], { error: "overloaded" })]).streams.get("");
		expect(shapeOf(events)).toBe("run_started notice:error run_finished:completed");
		expect(ofType(events, "notice")[0]?.text).toBe("API Error: overloaded");
	});

	test("an id too long for a block id shows nothing rather than a cut id", () => {
		const longId = `msg_${"x".repeat(300)}`;
		expect(shapeOf(play([assistant(longId, [text("a")])]).streams.get(""))).toBe("");
	});
});

describe("bounds", () => {
	test("deltas stop at the block's capacity and add up to what finishes it, never splitting a pair", () => {
		const big = `${"a".repeat(MAX_TEXT_CHARS - 1)}😀tail`;
		const events = play([
			messageStart(MSG),
			blockStart(0, text("")),
			textDelta(0, big.slice(0, 600_000)),
			textDelta(0, big.slice(600_000)),
			assistant(MSG, [text(big)]),
			messageStop(),
		]).streams.get("");
		const deltas = ofType(events, "block_delta")
			.map((event) => event.text)
			.join("");
		const finished = ofType(events, "block_finished")[0]?.text;
		expect(deltas.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
		expect(finished).toBe(deltas);
		expect(finished?.length).toBe(MAX_TEXT_CHARS - 1);
	});
});

describe("settle", () => {
	test("finishes an open block with its text so far, once", () => {
		const mapper = newMapper();
		mapper.map(messageStart(MSG));
		mapper.map(blockStart(0, text("")));
		mapper.map(textDelta(0, "half"));
		const settled = mapper.settle("aborted").map((item) => item.event);
		expect(settled).toEqual([{ type: "block_finished", blockId: `${MSG}:0`, text: "half" }]);
		expect(mapper.settle("aborted")).toEqual([]);
	});

	test("ends an open tool call aborted when the run was, failed when it completed without a result", () => {
		const aborted = newMapper();
		aborted.map(assistant(MSG, [toolUse("toolu_1", "Bash", { command: "ls" })]));
		expect(aborted.settle("aborted").map((item) => item.event)).toEqual([
			{ type: "tool_finished", toolCallId: "toolu_1", outcome: "aborted", result: { content: [], fileChanges: [] } },
		]);
		const completed = newMapper();
		completed.map(assistant(MSG, [toolUse("toolu_1", "Bash", { command: "ls" })]));
		const [ended] = completed.settle("completed").map((item) => item.event);
		expect(ended).toMatchObject({ type: "tool_finished", outcome: "failed" });
	});
});
