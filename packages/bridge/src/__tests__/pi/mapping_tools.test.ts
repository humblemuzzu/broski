/** tool calls, their live output and results, and the file changes built-in tools report. */

import { describe, expect, test } from "bun:test";
import { ToolCallIds } from "../../backends/pi/ids";
import {
	fileChangesOf,
	toolFinished,
	toolInputOf,
	toolOutcome,
	toolOutputOf,
	toolResultOf,
	toolStartedOfCall,
	toolStartedOfExecution,
} from "../../backends/pi/mapping/tool-items";
import { parseFrame } from "../../backends/pi/rpc/frames";
import { PI_TRAITS } from "../../backends/pi/traits";
import {
	type AgentEvent,
	emptySnapshot,
	FileChange,
	MAX_LIST_ITEMS,
	MAX_TEXT_CHARS,
	type SinkRecord,
	ToolResult,
} from "../../contract";
import { streamViolations } from "../../contract/testing/stream-rules";
import { deepFreeze, piEvent, records, toolCall, validEvents } from "./mapping_fixtures";

describe("outcome", () => {
	test.each([
		[{ isError: false, denied: false, aborted: false }, "completed"],
		[{ isError: true, denied: false, aborted: false }, "failed"],
		[{ isError: true, denied: false, aborted: true }, "aborted"],
		[{ isError: true, denied: true, aborted: false }, "denied"],
		[{ isError: true, denied: true, aborted: true }, "denied"],
		[{ isError: false, denied: false, aborted: true }, "aborted"],
	] as const)("%j is %s", (facts, outcome) => {
		expect(toolOutcome(facts)).toBe(outcome);
	});
});

describe("a call no message streamed", () => {
	test("a top-level call starts at tool_execution_start with its arguments", () => {
		const tools = new ToolCallIds();
		const [event] = validEvents([
			toolStartedOfExecution(
				deepFreeze({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } }),
				tools,
			),
		]);
		expect(event).toEqual({
			type: "tool_started",
			toolCallId: tools.liveId("c1"),
			name: "bash",
			input: { command: "ls" },
		});
	});

	test("a nested call names its running parent, by the parent's live id", () => {
		const tools = new ToolCallIds();
		const parent = toolStartedOfCall(toolCall("call_p", "codemode"), "msg-1", tools);
		const nested = toolStartedOfExecution(
			piEvent({
				type: "tool_execution_start",
				toolCallId: "call_p/1",
				toolName: "read",
				args: { path: "a" },
				parentToolCallId: "call_p",
			}),
			tools,
		);
		expect(nested).toMatchObject({ parentToolCallId: parent.toolCallId, name: "read" });
		const out: AgentEvent[] = validEvents([
			parent,
			nested,
			toolFinished("call_p/1", "completed", { content: [], fileChanges: [] }, tools),
			toolFinished("call_p", "completed", { content: [], fileChanges: [] }, tools),
		]);
		const recorded: SinkRecord[] = records([
			{ type: "run_started", runId: "r", trigger: "prompt" },
			...out,
			{ type: "run_finished", runId: "r", outcome: { kind: "completed" } },
		]);
		expect(streamViolations(recorded, PI_TRAITS, emptySnapshot())).toEqual([]);
	});

	test("a parent no one started leaves the nested call top-level rather than naming an unknown id", () => {
		const nested = toolStartedOfExecution(
			piEvent({ type: "tool_execution_start", toolCallId: "x/1", toolName: "read", args: {}, parentToolCallId: "x" }),
			new ToolCallIds(),
		);
		expect(nested).not.toHaveProperty("parentToolCallId");
	});

	test("a call with no name is shown under a placeholder", () => {
		const started = toolStartedOfExecution(
			piEvent({ type: "tool_execution_start", toolCallId: "c", toolName: "", args: {} }),
			new ToolCallIds(),
		);
		expect(validEvents([started])[0]).toMatchObject({ name: "unnamed" });
	});
});

describe("live output", () => {
	function raw(partialResult: unknown) {
		return { type: "tool_execution_update" as const, toolCallId: "c1", toolName: "bash", args: {}, partialResult };
	}
	const update = (partialResult: unknown) => piEvent(raw(partialResult));

	test("the whole output so far replaces the last, text blocks joined, escapes removed", () => {
		const tools = new ToolCallIds();
		const event = toolOutputOf(
			update({
				content: [
					{ type: "text", text: "\u001b[32mok\u001b[0m" },
					{ type: "image", data: "A", mimeType: "image/png" },
					{ type: "text", text: "more" },
				],
				details: undefined,
			}),
			tools,
		);
		expect(validEvents([event])[0]).toEqual({
			type: "tool_updated",
			toolCallId: tools.liveId("c1"),
			update: { kind: "output_replaced", text: "ok\nmore" },
		});
	});

	test("past the bound the newest text is kept", () => {
		const text = `${"a".repeat(10)}${"b".repeat(MAX_TEXT_CHARS)}`;
		const event = toolOutputOf(update({ content: [{ type: "text", text }] }), new ToolCallIds());
		expect(event.update).toEqual({ kind: "output_replaced", text: "b".repeat(MAX_TEXT_CHARS) });
	});

	test.each([
		[{}],
		[{ content: [null, { type: "text", text: 4 }] }],
	])("a partial result with no text in it (%j) is empty output", (partialResult) => {
		expect(toolOutputOf(update(partialResult), new ToolCallIds()).update).toEqual({
			kind: "output_replaced",
			text: "",
		});
	});

	test.each([
		[undefined],
		[null],
		["text"],
		[{ content: "no" }],
	])("an update whose partial result is not one (%j) is refused at the frame and never mapped", (partialResult) => {
		expect(parseFrame(JSON.stringify(raw(partialResult))).kind).toBe("invalid");
	});
});

describe("input", () => {
	test("the arguments toolcall_end carries are the input, bounded", () => {
		const tools = new ToolCallIds();
		const call = toolCall("c1", "write", { path: "a", content: "z".repeat(MAX_TEXT_CHARS + 3) });
		const event = toolInputOf(call, tools);
		expect(validEvents([event])[0]).toEqual({
			type: "tool_updated",
			toolCallId: tools.liveId("c1"),
			update: { kind: "input", input: { path: "a", content: "z".repeat(MAX_TEXT_CHARS) } },
		});
	});
});

describe("results", () => {
	const noImages = () => undefined;

	test("an extension's hint in the details is what the result shows in place of its text; a hint that is not one is no hint", () => {
		const text = [{ type: "text" as const, text: "3 files" }];
		const files = { kind: "files" as const, paths: ["/w/a.ts", "/w/b.ts"], total: 3 };
		expect(toolResultOf(text, false, [], noImages, { fileGroups: [], broski: files }).display).toEqual(files);
		expect(toolResultOf(text, false, [], noImages, { broski: { kind: "chart" } }).display).toBeUndefined();
		expect(toolResultOf(text, true, [], noImages, { broski: files }).display).toBeUndefined();
		const todos = { kind: "todos", items: [{ text: "Ship \u001b[1mit\u001b[0m", status: "pending" }] };
		expect(toolResultOf(text, false, [], noImages, { broski: todos }).display).toEqual({
			kind: "todos",
			items: [{ text: "Ship it", status: "pending" }],
		});
		const blank = { kind: "todos", items: [{ text: "\u001b[0m ", status: "pending" }] };
		expect(toolResultOf(text, false, [], noImages, { broski: blank }).display).toBeUndefined();
	});

	test("text blocks keep their order, escapes removed, empty ones dropped", () => {
		const result = toolResultOf(
			[
				{ type: "text", text: "a\u001b[1mb\u001b[0m" },
				{ type: "text", text: "" },
				{ type: "text", text: "c" },
			],
			false,
			[],
			noImages,
		);
		expect(ToolResult.parse(result)).toEqual({
			content: [
				{ kind: "text", text: "ab" },
				{ kind: "text", text: "c" },
			],
			fileChanges: [],
		});
	});

	test("an image is the reference imageRef gives for its content index, else a placeholder, never bytes", () => {
		const content = [
			{ type: "text" as const, text: "t" },
			{ type: "image" as const, data: "SECRET-BYTES", mimeType: "image/png" },
		];
		const named = toolResultOf(content, false, [], (index) => ({
			kind: "image_ref",
			id: `att-${index}`,
			mimeType: "image/png",
		}));
		expect(named.content[1]).toEqual({ kind: "image_ref", id: "att-1", mimeType: "image/png" });
		const placeholder = toolResultOf(content, false, [], noImages);
		expect(placeholder.content[1]).toEqual({ kind: "text", text: "[image/png image]" });
		expect(JSON.stringify([named, placeholder])).not.toContain("SECRET-BYTES");
	});

	test("a failed result puts its text in error, once, and reports no file changes", () => {
		const changes = [{ path: "p", change: "modified" as const }];
		const failed = toolResultOf(
			[
				{ type: "text", text: "line one" },
				{ type: "text", text: "line two" },
				{ type: "image", data: "A", mimeType: "image/png" },
			],
			true,
			changes,
			(index) => ({ kind: "image_ref", id: `att-${index}`, mimeType: "image/png" }),
		);
		expect(ToolResult.parse(failed)).toEqual({
			content: [{ kind: "image_ref", id: "att-2", mimeType: "image/png" }],
			fileChanges: [],
			error: "line one\nline two",
		});
		expect(toolResultOf([{ type: "text", text: "ok" }], false, changes, noImages).fileChanges).toEqual(changes);
	});

	test("a failed result with no text has no error", () => {
		expect(toolResultOf([], true, [], noImages)).toEqual({ content: [], fileChanges: [] });
	});

	test("lists and text are bounded", () => {
		const many = Array.from({ length: MAX_LIST_ITEMS + 5 }, () => ({ type: "text" as const, text: "x" }));
		expect(toolResultOf(many, false, [], noImages).content).toHaveLength(MAX_LIST_ITEMS);
		const changes = Array.from({ length: MAX_LIST_ITEMS + 5 }, (_, i) => ({
			path: `p${i}`,
			change: "modified" as const,
		}));
		expect(toolResultOf([], false, changes, noImages).fileChanges).toHaveLength(MAX_LIST_ITEMS);
		const long = toolResultOf([{ type: "text", text: "e".repeat(MAX_TEXT_CHARS + 1) }], true, [], noImages);
		expect(long.error).toHaveLength(MAX_TEXT_CHARS);
	});

	test("a result with no content list is an empty result", () => {
		expect(toolResultOf(undefined, false, [], noImages)).toEqual({ content: [], fileChanges: [] });
		expect(toolResultOf(null, true, [], noImages)).toEqual({ content: [], fileChanges: [] });
	});

	test("a block without text is skipped, not a throw", () => {
		const broken = JSON.parse('[{"type":"text"},{"type":"text","text":"ok"}]');
		expect(toolResultOf(broken, false, [], noImages).content).toEqual([{ kind: "text", text: "ok" }]);
	});

	test("toolFinished names the call by its live id", () => {
		const tools = new ToolCallIds();
		const event = toolFinished("c1", "denied", { content: [], fileChanges: [] }, tools);
		expect(validEvents([event])[0]).toEqual({
			type: "tool_finished",
			toolCallId: tools.liveId("c1"),
			outcome: "denied",
			result: { content: [], fileChanges: [] },
		});
	});
});

describe("file changes", () => {
	const patch = [
		"--- src/a.ts",
		"+++ src/a.ts",
		"@@ -1,3 +1,4 @@",
		" keep",
		"-removed",
		"+added one",
		"+added two",
		"--- a dashed line that was deleted",
		"+++ a plus line that was added",
		"@@ -20,2 +21,2 @@",
		"-x",
		"+y",
		"",
	].join("\n");

	test("edit: one modified change, the unified patch as diff, the lines counted inside the hunks", () => {
		const details = { diff: "display-oriented", patch, firstChangedLine: 2 };
		expect(fileChangesOf("edit", { path: "src/a.ts", edits: [] }, details)).toEqual([
			{ path: "src/a.ts", change: "modified", diff: patch, additions: 4, deletions: 3 },
		]);
	});

	test("edit: the path of the call wins; without one the patch header names it; without either, no change", () => {
		expect(fileChangesOf("edit", { path: "given.ts" }, { patch })[0]).toMatchObject({ path: "given.ts" });
		expect(fileChangesOf("edit", null, { patch })[0]).toMatchObject({ path: "src/a.ts" });
		expect(fileChangesOf("edit", null, { patch: "@@ -1 +1 @@\n-a\n+b\n" })).toEqual([]);
		expect(fileChangesOf("edit", { path: "" }, { patch: "no header" })).toEqual([]);
	});

	test("edit: no patch, no change (a failed edit has no details)", () => {
		expect(fileChangesOf("edit", { path: "a" }, undefined)).toEqual([]);
		expect(fileChangesOf("edit", { path: "a" }, { diff: "only display" })).toEqual([]);
		expect(fileChangesOf("edit", { path: "a" }, [patch])).toEqual([]);
	});

	test("edit: a patch past the bound is cut, its counts are of the whole", () => {
		const big = `--- f\n+++ f\n@@ -1 +1 @@\n${"+line\n".repeat(200_000)}`;
		const [change] = fileChangesOf("edit", { path: "f" }, { patch: big });
		expect(change?.diff).toHaveLength(MAX_TEXT_CHARS);
		expect(change?.additions).toBe(200_000);
		expect(FileChange.parse(change).deletions).toBe(0);
	});

	test("counting the lines of a megabyte patch, of any shape, stays linear", () => {
		const MB = 1024 * 1024;
		const shapes = [`@@\n${"+\n".repeat(MB / 2)}`, "@@\n".repeat(MB / 3), `@@ ${"x".repeat(MB)}`, "+".repeat(MB)];
		const started = performance.now();
		for (const patch of shapes) fileChangesOf("edit", { path: "f" }, { patch });
		expect(performance.now() - started).toBeLessThan(2000);
	});

	test("write: one modified change for the path, the lines written counted as added, nothing more is known", () => {
		expect(fileChangesOf("write", { path: "new.md", content: "x" }, undefined)).toEqual([
			{ path: "new.md", change: "modified", additions: 1 },
		]);
		const lines = (content: string) => fileChangesOf("write", { path: "f", content }, undefined)[0]?.additions;
		expect([lines(""), lines("a\n"), lines("a\nb"), lines("a\nb\n\n")]).toEqual([0, 1, 2, 3]);
		expect(fileChangesOf("write", { path: "f" }, undefined)).toEqual([{ path: "f", change: "modified" }]);
		expect(fileChangesOf("write", { content: "x" }, undefined)).toEqual([]);
		expect(fileChangesOf("write", "not an object", undefined)).toEqual([]);
	});

	test("other tools change nothing the adapter can name", () => {
		for (const name of ["bash", "read", "grep", "find", "ls", "codemode", "mcp__x__y"]) {
			expect(fileChangesOf(name, { path: "a" }, { patch })).toEqual([]);
		}
	});

	test("a change is valid under the contract, path bounded", () => {
		const long = "p".repeat(5000);
		const [change] = fileChangesOf("write", { path: long }, undefined);
		expect(FileChange.parse(change).path).toHaveLength(4096);
	});
});
