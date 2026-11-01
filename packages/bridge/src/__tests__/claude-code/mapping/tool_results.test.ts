/** Tool results: `toolResultOf` over the shapes the CLI sends, and the live flow from `tool_use` to `tool_finished`. */

import { describe, expect, test } from "bun:test";
import { toolResultOf } from "../../../backends/claude-code/mapping/tool-results";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS, ToolResult } from "../../../contract";
import { assistant, ids, toolResult, toolUse, uuid } from "./frames";
import { newMapper, ofType, play } from "./helpers";

const ENTRY = "00000000-0000-4000-8000-0000000000aa";
const PLACE = { entryUuid: ENTRY, blockIndex: 0 };

function resultOf(block: unknown, structured: unknown = undefined, toolName: string | undefined = undefined) {
	const mapped = toolResultOf(block, structured, PLACE, toolName);
	expect(ToolResult.safeParse(mapped.result).success).toBe(true);
	return mapped;
}

const block = (content: unknown, isError = false) => ({
	type: "tool_result",
	tool_use_id: "toolu_1",
	content,
	...(isError && { is_error: true }),
});

describe("a completed result", () => {
	test("a string is one text part", () => {
		expect(resultOf(block("done"))).toEqual({
			outcome: "completed",
			result: { content: [{ kind: "text", text: "done" }], fileChanges: [] },
		});
	});

	test("blocks become parts in order; an image is a reference named by its place, never its bytes", () => {
		const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
		const { result } = resultOf(block([{ type: "text", text: "see" }, image, { type: "text", text: "after" }]));
		expect(result.content).toEqual([
			{ kind: "text", text: "see" },
			{ kind: "image_ref", id: `${ENTRY}:0:1`, mimeType: "image/png" },
			{ kind: "text", text: "after" },
		]);
		expect(JSON.stringify(result)).not.toContain("AAAA");
	});

	test("an image with no bytes in it (a URL) is a placeholder", () => {
		const image = { type: "image", source: { type: "url", url: "https://example.com/a.png" } };
		expect(resultOf(block([image])).result.content).toEqual([{ kind: "text", text: "[image]" }]);
	});

	test("search results, documents and tool references read as text", () => {
		const { result } = resultOf(
			block([
				{ type: "search_result", title: "Doc", source: "https://x", content: [{ type: "text", text: "body" }] },
				{ type: "document", title: "Spec", source: {} },
				{ type: "tool_reference", tool_name: "Grep" },
			]),
		);
		expect(result.content).toEqual([
			{ kind: "text", text: "Doc\nhttps://x\nbody" },
			{ kind: "text", text: "[document: Spec]" },
			{ kind: "text", text: "[tool: Grep]" },
		]);
	});

	test("terminal escapes are removed from what a tool printed", () => {
		expect(resultOf(block("\u001B[31mred\u001B[0m ok")).result.content).toEqual([{ kind: "text", text: "red ok" }]);
	});

	test("text and parts are bounded", () => {
		const long = resultOf(block("x".repeat(MAX_TEXT_CHARS + 10))).result.content;
		expect(long[0]?.kind === "text" && long[0].text.length).toBe(MAX_TEXT_CHARS);
		const many = resultOf(block(Array.from({ length: MAX_LIST_ITEMS + 5 }, () => ({ type: "text", text: "a" })))).result
			.content;
		expect(many).toHaveLength(MAX_LIST_ITEMS);
	});
});

describe("the tool's own output, where it says more than the model's text", () => {
	test("Bash shows stdout and stderr, and has no exit code to report", () => {
		const { result } = resultOf(block("model text"), { stdout: "out\n", stderr: "warn", interrupted: false }, "Bash");
		expect(result.content).toEqual([{ kind: "text", text: "out\n\nwarn" }]);
		expect(result.exitCode).toBeUndefined();
	});

	test("a Bash call with no output shows the model's note", () => {
		const { result } = resultOf(block("(Bash completed with no output)"), { stdout: "", stderr: "" }, "Bash");
		expect(result.content).toEqual([{ kind: "text", text: "(Bash completed with no output)" }]);
	});

	test("an agent's report loses the harness tag that opens it for the model", () => {
		const output = {
			status: "completed",
			content: [
				{ type: "text", text: "<tools-used-before-summary>Read</tools-used-before-summary>\n" },
				{ type: "text", text: "Found it." },
			],
		};
		expect(resultOf(block("hand-back prose"), output, "Agent").result.content).toEqual([
			{ kind: "text", text: "Found it." },
		]);
	});

	test("a background or remote agent says where it went", () => {
		const background = resultOf(
			block("internal"),
			{ status: "async_launched", description: "Find the word", agentId: "a1" },
			"Agent",
		);
		expect(background.result.content).toEqual([
			{ kind: "text", text: "Agent started in the background: Find the word" },
		]);
		const remote = resultOf(
			block("internal"),
			{ status: "remote_launched", sessionUrl: "https://claude.ai/s/1" },
			"Task",
		);
		expect(remote.result.content).toEqual([{ kind: "text", text: "Agent started remotely: https://claude.ai/s/1" }]);
	});

	test("WebFetch shows the distilled result", () => {
		expect(resultOf(block("raw"), { result: "summary", code: 200 }, "WebFetch").result.content).toEqual([
			{ kind: "text", text: "summary" },
		]);
	});

	test("an image keeps the blocks, whatever the tool says", () => {
		const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
		const { result } = resultOf(block([image]), { stdout: "ignored", stderr: "" }, "Bash");
		expect(result.content.map((part) => part.kind)).toEqual(["image_ref"]);
	});
});

describe("a result the CLI marked is_error", () => {
	test("is failed, its text is the error, and it changed no file", () => {
		const mapped = resultOf(block("Exit code 1\nboom", true), "Exit code 1\nboom", "Bash");
		expect(mapped).toEqual({ outcome: "failed", result: { content: [], fileChanges: [], error: "Exit code 1\nboom" } });
	});

	test("without text still says it failed", () => {
		expect(resultOf(block("", true)).result.error).toBe("The tool call failed");
	});

	test("a call cut short by an interrupt is aborted and shows no model-directed prose", () => {
		const text =
			"The user doesn't want to proceed with this tool use. The tool use was rejected. Correction to the text above: this call was stopped while running, not refused before it ran.";
		expect(resultOf(block(text, true))).toEqual({ outcome: "aborted", result: { content: [], fileChanges: [] } });
		expect(resultOf(block("[Request interrupted by user for tool use]", true)).outcome).toBe("aborted");
	});

	test.each([
		[
			"a person's no in the CLI's own prompt",
			"The user doesn't want to take this action right now. STOP what you are doing.",
		],
		["a permission rule", "Permission to use Bash with command rm -rf / has been denied."],
		[
			"a mode that cannot ask",
			"Permission for this tool use was denied. It requires approval, and this session has no approval surface",
		],
	])("%s is denied", (_name, text) => {
		const mapped = resultOf(block(text, true));
		expect(mapped.outcome).toBe("denied");
		expect(mapped.result.error).toBe(text);
	});

	test("any other message is a failure, including a person's own words", () => {
		expect(resultOf(block("Not that file.", true)).outcome).toBe("failed");
	});
});

describe("file changes", () => {
	test("a file written new is added, with every line in its diff", () => {
		const { result } = resultOf(
			block("created"),
			{ type: "create", filePath: "/p/a.txt", content: "one\ntwo\n", structuredPatch: [], originalFile: null },
			"Write",
		);
		expect(result.fileChanges).toEqual([
			{
				path: "/p/a.txt",
				change: "added",
				diff: "--- /dev/null\n+++ /p/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two",
				additions: 2,
				deletions: 0,
			},
		]);
	});

	test("an edit is modified, with its hunks and their counts", () => {
		const output = {
			filePath: "/p/a.txt",
			structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" keep", "-old", "+new"] }],
		};
		expect(resultOf(block("ok"), output, "Edit").result.fileChanges).toEqual([
			{
				path: "/p/a.txt",
				change: "modified",
				diff: "--- /p/a.txt\n+++ /p/a.txt\n@@ -1,2 +1,2 @@\n keep\n-old\n+new",
				additions: 1,
				deletions: 1,
			},
		]);
	});

	test("without hunks the git diff stands in, with the counts the tool reports", () => {
		const output = {
			filePath: "/p/a.txt",
			structuredPatch: [],
			gitDiff: {
				filename: "a.txt",
				status: "modified",
				additions: 3,
				deletions: 1,
				changes: 4,
				patch: "@@ -1 +1 @@\n-a\n+b",
			},
		};
		const [change] = resultOf(block("ok"), output, "Edit").result.fileChanges;
		expect(change).toEqual({
			path: "/p/a.txt",
			change: "modified",
			diff: "--- /p/a.txt\n+++ /p/a.txt\n@@ -1 +1 @@\n-a\n+b",
			additions: 3,
			deletions: 1,
		});
	});

	test("a write held for review changed nothing", () => {
		const output = { type: "update", filePath: "/p/a.txt", content: "x", structuredPatch: [], staged: true };
		expect(resultOf(block("held"), output, "Write").result.fileChanges).toEqual([]);
	});

	test("a notebook cell is modified, a failed edit is nothing, other tools change no file", () => {
		const output = { notebook_path: "/p/n.ipynb", old_source: "a = 1", new_source: "a = 2", edit_mode: "replace" };
		expect(resultOf(block("ok"), output, "NotebookEdit").result.fileChanges).toEqual([
			{
				path: "/p/n.ipynb",
				change: "modified",
				diff: "--- /p/n.ipynb\n+++ /p/n.ipynb\n@@ -1,1 +1,1 @@\n-a = 1\n+a = 2",
				additions: 1,
				deletions: 1,
			},
		]);
		expect(resultOf(block("ok"), { ...output, error: "no such cell" }, "NotebookEdit").result.fileChanges).toEqual([]);
		expect(resultOf(block("ok"), output, "Read").result.fileChanges).toEqual([]);
	});
});

describe("a result of a shape nobody expects", () => {
	test.each([
		[undefined],
		[null],
		[7],
		["text"],
		[[]],
		[{}],
		[{ type: "tool_result" }],
		[{ content: { nested: true }, is_error: "yes" }],
	])("%p never throws", (garbage) => {
		expect(() => toolResultOf(garbage, garbage, PLACE, "Bash")).not.toThrow();
		expect(ToolResult.safeParse(toolResultOf(garbage, garbage, PLACE, "Write").result).success).toBe(true);
	});
});

describe("the live flow", () => {
	const call = (id: string, name: string, input: unknown) => assistant("msg_1", [toolUse(id, name, input)]);

	test("a result for a call nobody started, and a second result for one that ended, say nothing", () => {
		const mapper = newMapper();
		expect(mapper.map(toolResult("toolu_x", "late"))).toEqual([]);
		mapper.map(call("toolu_1", "Bash", { command: "ls" }));
		expect(mapper.map(toolResult("toolu_1", "a"))).toHaveLength(1);
		expect(mapper.map(toolResult("toolu_1", "again"))).toEqual([]);
	});

	test("a permission_denied frame turns that call's failure into denied", () => {
		const mapper = newMapper();
		mapper.map(call("toolu_1", "Bash", { command: "rm" }));
		mapper.map({
			type: "system",
			subtype: "permission_denied",
			tool_name: "Bash",
			tool_use_id: "toolu_1",
			message: "no",
			...ids(),
		});
		const [ended] = mapper
			.map(toolResult("toolu_1", "No rule allows that.", { isError: true }))
			.map((item) => item.event);
		expect(ended).toMatchObject({ type: "tool_finished", outcome: "denied" });
	});

	test("a file change finds its path in the call's input when the result lacks it", () => {
		const events = play([
			call("toolu_1", "Write", { file_path: "/p/new.txt", content: "hi\n" }),
			toolResult("toolu_1", "ok", { structured: { type: "create", content: "hi\n", structuredPatch: [] } }),
		]).streams.get("");
		expect(ofType(events, "tool_finished")[0]?.result.fileChanges[0]).toMatchObject({
			path: "/p/new.txt",
			change: "added",
		});
	});

	test("parallel results in one frame carry no structured output, so none is guessed for them", () => {
		const frame = toolResult("toolu_1", "one", {
			structured: { stdout: "STRUCTURED", stderr: "", interrupted: false },
		});
		const both = {
			...frame,
			message: {
				role: "user" as const,
				content: [
					{ type: "tool_result" as const, tool_use_id: "toolu_1", content: "one" },
					{ type: "tool_result" as const, tool_use_id: "toolu_2", content: "two" },
				],
			},
		};
		const events = play([
			call("toolu_1", "Bash", { command: "a" }),
			call("toolu_2", "Bash", { command: "b" }),
			both,
		]).streams.get("");
		expect(ofType(events, "tool_finished").map((event) => event.result.content)).toEqual([
			[{ kind: "text", text: "one" }],
			[{ kind: "text", text: "two" }],
		]);
	});

	test("an image in a result is named by the frame's uuid, its block and its place inside", () => {
		const image = {
			type: "image" as const,
			source: { type: "base64" as const, media_type: "image/png" as const, data: "AAAA" },
		};
		const frame = toolResult("toolu_1", [image]);
		const events = play([call("toolu_1", "Read", { file_path: "p.png" }), frame]).streams.get("");
		expect(ofType(events, "tool_finished")[0]?.result.content).toEqual([
			{ kind: "image_ref", id: `${frame.uuid}:0:0`, mimeType: "image/png" },
		]);
	});

	test("a call whose id does not fit an id is not started, and its result is not shown", () => {
		const longId = `toolu_${"x".repeat(300)}`;
		const events = play([call(longId, "Bash", {}), toolResult(longId, "r")]).streams.get("");
		expect(ofType(events, "tool_started")).toEqual([]);
		expect(ofType(events, "tool_finished")).toEqual([]);
		expect(uuid()).toBeString();
	});
});
