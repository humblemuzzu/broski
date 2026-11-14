import { describe, expect, test } from "bun:test";
import { toolResultOf } from "../../../backends/claude-code/mapping/tool-results";
import { LineTranslator } from "../../../backends/claude-code/terminal/translate";
import { CLAUDE_CODE_TRAITS } from "../../../backends/claude-code/traits";
import { type AgentEvent, emptySnapshot, MAX_TEXT_CHARS, type SinkRecord } from "../../../contract";
import { streamViolations, unsettledParts } from "../../../contract/testing/stream-rules";
import { assistant, noise, prompt, system, text, thinking, toolResult, toolUse, turnDuration } from "./lines";

function run(lines: readonly unknown[], translator = new LineTranslator()) {
	const events: AgentEvent[] = lines.flatMap((line) => translator.translate(line).map((mapped) => mapped.event));
	return { events, translator };
}

function kinds(events: readonly AgentEvent[]): string[] {
	return events.map((event) => event.type);
}

function legal(events: readonly AgentEvent[]): void {
	const records: SinkRecord[] = events.map((event) => ({ at: 0, event }));
	expect(streamViolations(records, CLAUDE_CODE_TRAITS, emptySnapshot())).toEqual([]);
	expect(unsettledParts(records, emptySnapshot())).toEqual([]);
}

describe("LineTranslator", () => {
	test("a turn a terminal ran: an external run, the prompt, thinking and text, closed by turn_duration", () => {
		const { events } = run([
			prompt("hello", "11111111-1111-4111-8111-111111111111"),
			assistant("msg_1", thinking("hmm"), { index: 0 }),
			assistant("msg_1", text("Hi there"), { index: 1 }),
			turnDuration(),
		]);
		expect(kinds(events)).toEqual([
			"run_started",
			"user_message",
			"block_started",
			"block_finished",
			"block_started",
			"block_finished",
			"run_finished",
		]);
		expect(events[0]).toMatchObject({
			type: "run_started",
			trigger: "external",
		});
		expect(events[1]).toMatchObject({
			type: "user_message",
			messageId: "11111111-1111-4111-8111-111111111111",
			text: "hello",
		});
		expect(events[2]).toMatchObject({
			type: "block_started",
			blockId: "msg_1:0",
			messageId: "msg_1",
			kind: "thinking",
		});
		expect(events[5]).toMatchObject({
			type: "block_finished",
			blockId: "msg_1:1",
			text: "Hi there",
		});
		expect(events[6]).toMatchObject({
			type: "run_finished",
			outcome: { kind: "completed" },
		});
		legal(events);
	});

	test("a tool call and its result: the result is whatever the mapping's helper makes of it", () => {
		const result = toolResult("toolu_1", "file text", {
			type: "text",
			file: { filePath: "README.md" },
		});
		const { events } = run([
			prompt("read it"),
			assistant("msg_1", toolUse("toolu_1", "Read", { file_path: "README.md" }), { index: 0, stop: "tool_use" }),
			result,
			assistant("msg_2", text("Done."), { index: 0 }),
			turnDuration(),
		]);
		expect(kinds(events)).toEqual([
			"run_started",
			"user_message",
			"tool_started",
			"tool_finished",
			"block_started",
			"block_finished",
			"run_finished",
		]);
		expect(events[2]).toMatchObject({
			type: "tool_started",
			toolCallId: "toolu_1",
			name: "Read",
			input: { file_path: "README.md" },
			messageId: "msg_1",
		});
		const block = {
			tool_use_id: "toolu_1",
			type: "tool_result",
			content: "file text",
		};
		const expected = toolResultOf(
			block,
			{ type: "text", file: { filePath: "README.md" } },
			{ entryUuid: String(result.uuid), blockIndex: 0 },
			"Read",
		);
		expect(events[3]).toMatchObject({
			type: "tool_finished",
			toolCallId: "toolu_1",
			outcome: expected.outcome,
			result: expected.result,
		});
		legal(events);
	});

	test("lines that mean nothing to a live view produce nothing", () => {
		const { events } = run(noise());
		expect(events).toEqual([]);
	});

	test("meta lines, compaction summaries and sidechains are not shown", () => {
		const { events } = run([
			prompt("<system-reminder>x</system-reminder>", undefined, {
				isMeta: true,
			}),
			prompt("summary of earlier", undefined, { isCompactSummary: true }),
			prompt("from a subagent", undefined, { isSidechain: true }),
			{
				...assistant("msg_s", text("sidechain"), { index: 0 }),
				isSidechain: true,
			},
		]);
		expect(events).toEqual([]);
	});

	test("the CLI's own notes in a user line are not prompts; a slash command is shown as the person typed it", () => {
		const { events } = run([
			prompt("<local-command-stdout>ok</local-command-stdout>"),
			prompt("<system-reminder>be good</system-reminder>"),
			prompt(
				"<command-message>foo</command-message><command-name>/foo</command-name><command-args>bar baz</command-args>",
			),
			prompt("   "),
		]);
		expect(events.filter((event) => event.type === "user_message")).toEqual([
			expect.objectContaining({ text: "/foo bar baz" }),
		]);
	});

	test("an interruption ends the run aborted and the tool it cut off is finished aborted before it", () => {
		const { events } = run([
			prompt("go"),
			assistant("msg_1", toolUse("toolu_1", "Bash", { command: "sleep 99" }), {
				index: 0,
				stop: "tool_use",
			}),
			toolResult("toolu_x", "[Request interrupted by user for tool use]"),
			prompt("[Request interrupted by user for tool use]"),
		]);
		expect(kinds(events).slice(-2)).toEqual(["tool_finished", "run_finished"]);
		expect(events.at(-2)).toMatchObject({
			type: "tool_finished",
			toolCallId: "toolu_1",
			outcome: "aborted",
		});
		expect(events.at(-1)).toMatchObject({
			type: "run_finished",
			outcome: { kind: "aborted" },
		});
		legal(events);
	});

	test("a line seen twice, or already in the file when the tail began, is shown once or never", () => {
		const translator = new LineTranslator();
		const old = prompt("old prompt");
		translator.remember(old);
		const fresh = prompt("new prompt");
		const { events } = run([old, fresh, fresh], translator);
		expect(events.filter((event) => event.type === "user_message")).toHaveLength(1);
		expect(events.find((event) => event.type === "user_message")).toMatchObject({ text: "new prompt" });
	});

	test("a result for a tool the tail never saw start (it attached mid-turn) is ignored", () => {
		const { events } = run([toolResult("toolu_before", "late"), assistant("msg_9", text("tail"), { index: 0 })]);
		expect(kinds(events)).toEqual(["run_started", "block_started", "block_finished"]);
	});

	test("without turn_duration a settled turn is finished by settle(); one still waiting for a tool result is not", () => {
		const open = run([
			prompt("go"),
			assistant("msg_1", toolUse("toolu_1", "Bash", { command: "ls" }), {
				index: 0,
				stop: "tool_use",
			}),
		]);
		expect(open.translator.settled).toBe(false);
		expect(open.translator.settle()).toEqual([]);
		const done = run([prompt("go"), assistant("msg_1", text("ok"), { index: 0, stop: "end_turn" })]);
		expect(done.translator.settled).toBe(true);
		const closing = done.translator.settle().map((mapped) => mapped.event);
		expect(kinds(closing)).toEqual(["run_finished"]);
		legal([...done.events, ...closing]);
	});

	test("a message that has not stopped yet (stop_reason null) is not a settled turn", () => {
		const { translator } = run([prompt("go"), assistant("msg_1", text("part"), { index: 0, stop: null })]);
		expect(translator.settled).toBe(false);
	});

	test("a new prompt after a settled turn the file never closed closes it first", () => {
		const { events } = run([
			prompt("one"),
			assistant("msg_1", text("a"), { index: 0 }),
			prompt("two"),
			assistant("msg_2", text("b"), { index: 0 }),
			turnDuration(),
		]);
		expect(kinds(events)).toEqual([
			"run_started",
			"user_message",
			"block_started",
			"block_finished",
			"run_finished",
			"run_started",
			"user_message",
			"block_started",
			"block_finished",
			"run_finished",
		]);
		legal(events);
	});

	test("a prompt typed while a tool is running joins the run instead of starting another", () => {
		const { events } = run([
			prompt("go"),
			assistant("msg_1", toolUse("toolu_1", "Bash", { command: "ls" }), {
				index: 0,
				stop: "tool_use",
			}),
			prompt("also this"),
		]);
		expect(kinds(events).filter((kind) => kind === "run_started")).toHaveLength(1);
		expect(events.at(-1)).toMatchObject({
			type: "user_message",
			text: "also this",
		});
	});

	test("compaction: a started and a finished event with the tokens the file gives", () => {
		const { events } = run([
			system("compact_boundary", {
				compactMetadata: { trigger: "manual", preTokens: 900, postTokens: 100 },
			}),
			system("compact_boundary", {
				compactMetadata: { trigger: "weird", preTokens: -1 },
			}),
			system("compact_boundary"),
		]);
		expect(events).toEqual([
			{ type: "compaction_started", trigger: "manual" },
			{
				type: "compaction_finished",
				outcome: { kind: "completed", tokensBefore: 900, tokensAfter: 100 },
			},
			{ type: "compaction_started", trigger: "auto" },
			{ type: "compaction_finished", outcome: { kind: "completed" } },
			{ type: "compaction_started", trigger: "auto" },
			{ type: "compaction_finished", outcome: { kind: "completed" } },
		]);
		legal(events);
	});

	test("a slash command the CLI runs itself is a turn its output ends, in the order the file has it; a mid-turn compaction is no turn", () => {
		const manual = run([
			system("compact_boundary", { compactMetadata: { trigger: "manual", preTokens: 5 } }),
			prompt("This session is being continued from a previous conversation", undefined, { isCompactSummary: true }),
			prompt("<local-command-caveat>not sent to you</local-command-caveat>", undefined, { isMeta: true }),
			prompt("<command-name>/compact</command-name>\n<command-message>compact</command-message>"),
			prompt("<local-command-stdout>Compacted </local-command-stdout>"),
		]);
		expect(kinds(manual.events)).toEqual([
			"compaction_started",
			"compaction_finished",
			"run_started",
			"user_message",
			"run_finished",
		]);
		legal(manual.events);
		expect(run([prompt("<local-command-stdout>nothing running</local-command-stdout>")]).events).toEqual([]);
		const auto = run([
			prompt("go"),
			system("compact_boundary", { compactMetadata: { trigger: "auto", preTokens: 5 } }),
			assistant("msg_1", text("continuing"), { index: 0 }),
			turnDuration(),
		]);
		expect(kinds(auto.events).filter((kind) => kind === "run_started")).toHaveLength(1);
		legal(auto.events);
	});

	test("a block without apiBlockIndex takes its message's next position; with it, that index", () => {
		const { events } = run([
			prompt("go"),
			assistant("msg_1", thinking("a")),
			assistant("msg_1", text("b")),
			assistant("msg_2", text("c"), { index: 5 }),
		]);
		const ids = events.flatMap((event) => (event.type === "block_started" ? [event.blockId] : []));
		expect(ids).toEqual(["msg_1:0", "msg_1:1", "msg_2:5"]);
	});

	test("hostile lines are skipped: not objects, no message, empty blocks, ids that do not fit", () => {
		const { events } = run([
			null,
			"text",
			[],
			{ type: "user", uuid: "a" },
			{ type: "user", uuid: "b", message: "x" },
			{ type: "assistant", uuid: "c", message: { id: 5, content: [] } },
			{
				type: "assistant",
				uuid: "d",
				message: { id: "m".repeat(300), content: [text("x")] },
			},
			assistant("msg_1", text("   "), { index: 0 }),
			assistant("msg_1", toolUse("t".repeat(300), "Bash", {}), { index: 1 }),
			{ type: "system", uuid: "e" },
			{ type: "unknown", uuid: "f" },
		]);
		expect(events).toEqual([]);
	});

	test("what comes from the file is bounded: a huge text and a huge tool input", () => {
		const { events } = run([
			prompt("x".repeat(MAX_TEXT_CHARS + 500)),
			assistant("msg_1", text("y".repeat(MAX_TEXT_CHARS + 500)), { index: 0 }),
			assistant(
				"msg_2",
				toolUse("toolu_1", "Write", {
					content: "z".repeat(MAX_TEXT_CHARS + 500),
				}),
				{ index: 0, stop: "tool_use" },
			),
		]);
		const message = events.find((event) => event.type === "user_message");
		expect(message?.type === "user_message" && message.text.length).toBe(MAX_TEXT_CHARS);
		const block = events.find((event) => event.type === "block_finished");
		expect(block?.type === "block_finished" && block.text.length).toBe(MAX_TEXT_CHARS);
		const tool = events.find((event) => event.type === "tool_started");
		expect(JSON.stringify(tool).length).toBeLessThan(MAX_TEXT_CHARS + 2_000);
	});

	test("a long text full of command tags is read in bounded time and shown as the prompt it is", () => {
		const hostile = "<command-name>".repeat(300_000);
		const started = performance.now();
		const { events } = run([prompt(hostile)]);
		expect(performance.now() - started).toBeLessThan(500);
		expect(events.map((event) => event.type)).toEqual([]);
		const long = `fix this: ${"<command-name>".repeat(300_000)}`;
		expect(run([prompt(long)]).events.map((event) => event.type)).toEqual(["run_started", "user_message"]);
	});

	test("an open tool is found by name and input (key order aside), else by name when only one is open", () => {
		const { translator } = run([
			prompt("go"),
			assistant("msg_1", toolUse("toolu_a", "Bash", { command: "ls", description: "list" }), {
				index: 0,
				stop: "tool_use",
			}),
			assistant("msg_1", toolUse("toolu_b", "Bash", { command: "pwd" }), {
				index: 1,
				stop: "tool_use",
			}),
			assistant("msg_1", toolUse("toolu_c", "Write", { file_path: "a", content: "b" }), { index: 2, stop: "tool_use" }),
		]);
		expect(
			translator.openToolMatching("Bash", {
				description: "list",
				command: "ls",
			}),
		).toBe("toolu_a");
		expect(translator.openToolMatching("Bash", { command: "pwd" })).toBe("toolu_b");
		expect(translator.openToolMatching("Bash", { command: "other" })).toBeUndefined();
		expect(translator.openToolMatching("Write", { file_path: "changed" })).toBe("toolu_c");
		expect(translator.openToolMatching("Read", {})).toBeUndefined();
	});
});
