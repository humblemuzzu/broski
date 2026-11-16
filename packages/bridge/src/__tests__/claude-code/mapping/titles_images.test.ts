/** `toolTitle` and the image helpers the store, the asks and the terminal tail share with the mapping. */

import { describe, expect, test } from "bun:test";
import { imageAt, imageRefsOf } from "../../../backends/claude-code/mapping/images";
import { toolTitle } from "../../../backends/claude-code/mapping/tool-titles";
import { MAX_IMAGE_CHARS, MAX_NAME_CHARS } from "../../../contract";

describe("toolTitle", () => {
	test.each([
		["Read", { file_path: "/p/README.md" }, "Read /p/README.md"],
		["Write", { file_path: "/p/a.ts", content: "x" }, "Write /p/a.ts"],
		["Edit", { file_path: "/p/a.ts", old_string: "a", new_string: "b" }, "Edit /p/a.ts"],
		["NotebookEdit", { notebook_path: "/p/n.ipynb", new_source: "" }, "Edit notebook /p/n.ipynb"],
		["Bash", { command: "ls -la\necho two" }, "Bash: ls -la"],
		["PowerShell", { command: "Get-ChildItem" }, "PowerShell: Get-ChildItem"],
		["Glob", { pattern: "**/*.ts" }, "Glob **/*.ts"],
		["Grep", { pattern: "TODO", path: "src" }, "Grep TODO"],
		["WebFetch", { url: "https://example.com", prompt: "p" }, "Fetch https://example.com"],
		["WebSearch", { query: "bun test" }, "Search bun test"],
		["Agent", { description: "Find the word", prompt: "p" }, "Agent Find the word"],
		["Task", { description: "Legacy name", prompt: "p" }, "Agent Legacy name"],
		["TaskCreate", { subject: "Write docs", description: "d" }, "Create task Write docs"],
		["mcp__elicit__ask_form", {}, "elicit: ask_form"],
		["mcp__plugin_docs_x__export", {}, "plugin_docs_x: export"],
	])("%s %j is %p", (name, input, title) => {
		expect(toolTitle(name, input)).toBe(title);
	});

	test.each([
		["TodoWrite", "Update todo list"],
		["AskUserQuestion", "Ask a question"],
		["ExitPlanMode", "Exit plan mode"],
	])("%s needs no input to be titled", (name, title) => {
		expect(toolTitle(name, undefined)).toBe(title);
	});

	test("a todo list's title says how far it is and what is under way, as the CLI's spinner does", () => {
		const todo = (content: string, status: string, activeForm = content) => ({ content, status, activeForm });
		const todos = [
			todo("Read the code", "completed"),
			todo("Write the tests", "in_progress", "Writing the tests"),
			todo("Ship", "pending"),
		];
		expect(toolTitle("TodoWrite", { todos })).toBe("Tasks 1/3 · Writing the tests");
		expect(toolTitle("TodoWrite", { todos: todos.map((item) => ({ ...item, status: "completed" })) })).toBe(
			"Tasks 3/3",
		);
		expect(toolTitle("TodoWrite", { todos: [] })).toBe("Update todo list");
	});

	test("a tool or an input it knows nothing about has no title, so the app shows the name", () => {
		expect(toolTitle("Whatever", { a: 1 })).toBeUndefined();
		expect(toolTitle("Read", {})).toBeUndefined();
		expect(toolTitle("Read", { file_path: "   " })).toBeUndefined();
		expect(toolTitle("Bash", "ls")).toBeUndefined();
		expect(toolTitle("Bash", null)).toBeUndefined();
		expect(toolTitle("mcp__", {})).toBeUndefined();
	});

	test("a name of an object's own property is just a name", () => {
		for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
			expect(toolTitle(name, { file_path: "x" })).toBeUndefined();
		}
	});

	test("is one bounded line, escapes removed", () => {
		const title = toolTitle("Bash", { command: `\u001B[1mecho\u001B[0m ${"y".repeat(5_000)}` });
		expect(title?.startsWith("Bash: echo yyy")).toBe(true);
		expect(title?.length).toBeLessThanOrEqual(160);
		expect(title?.length).toBeLessThanOrEqual(MAX_NAME_CHARS);
		expect(toolTitle("Read", { file_path: "a\nb\tc" })).toBe("Read a b c");
	});
});

const PNG = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } };
const ENTRY = "00000000-0000-4000-8000-0000000000bb";

describe("imageRefsOf", () => {
	test("names each image block by its entry and position, and carries no bytes", () => {
		const refs = imageRefsOf([{ type: "text", text: "look" }, PNG, PNG], ENTRY);
		expect(refs).toEqual([
			{ kind: "image_ref", id: `${ENTRY}:1`, mimeType: "image/png" },
			{ kind: "image_ref", id: `${ENTRY}:2`, mimeType: "image/png" },
		]);
		expect(JSON.stringify(refs)).not.toContain("iVBOR");
	});

	test("a string, a URL image or a broken block is none", () => {
		expect(imageRefsOf("just text", ENTRY)).toEqual([]);
		expect(imageRefsOf([{ type: "image", source: { type: "url", url: "https://x/y.png" } }], ENTRY)).toEqual([]);
		expect(imageRefsOf([{ type: "image" }, null, 3, { type: "image", source: { type: "base64" } }], ENTRY)).toEqual([]);
		expect(imageRefsOf(undefined, ENTRY)).toEqual([]);
	});
});

describe("imageAt", () => {
	test("reads the bytes back for the id imageRefsOf made", () => {
		expect(imageAt([{ type: "text", text: "a" }, PNG], { entryUuid: ENTRY, blockIndex: 1 })).toEqual({
			kind: "image",
			mimeType: "image/png",
			data: "iVBORw0K",
		});
	});

	test("reads an image inside a tool result by its inner index", () => {
		const content = [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "a" }, PNG] }];
		expect(imageAt(content, { entryUuid: ENTRY, blockIndex: 0, innerIndex: 1 })?.data).toBe("iVBORw0K");
		expect(imageAt(content, { entryUuid: ENTRY, blockIndex: 0, innerIndex: 0 })).toBeUndefined();
		expect(imageAt(content, { entryUuid: ENTRY, blockIndex: 0 })).toBeUndefined();
	});

	test("an index that names nothing, or bytes past the bound, is undefined", () => {
		expect(imageAt([PNG], { entryUuid: ENTRY, blockIndex: 5 })).toBeUndefined();
		expect(imageAt("text", { entryUuid: ENTRY, blockIndex: 0 })).toBeUndefined();
		const huge = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "A".repeat(MAX_IMAGE_CHARS + 1) },
		};
		expect(imageAt([huge], { entryUuid: ENTRY, blockIndex: 0 })).toBeUndefined();
	});
});
