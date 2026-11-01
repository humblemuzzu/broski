/** `custom_tools` and `custom_tool` (D30): only through the custom tools port, with the same file rules as `config_file`. */

import { afterEach, describe, expect, test } from "bun:test";
import { ABSENT_REVISION, revisionOfText } from "../../../backends/claude-code/ops/file-state";
import type { CustomToolsPort } from "../../../backends/claude-code/ports";
import type { ActionList, BackendCallResult, EditableFile, EditableFileChange } from "../../../contract";
import { memoryCustomTools } from "../conformance/memory-custom-tools";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

function listOf(result: BackendCallResult): ActionList {
	if (result.status !== "accepted" || result.result.kind !== "custom_tools") throw new Error(JSON.stringify(result));
	return result.result.list;
}

function fileOf(result: BackendCallResult): EditableFile {
	if (result.status !== "accepted" || result.result.kind !== "custom_tool") throw new Error(JSON.stringify(result));
	return result.result.file;
}

function codeOf(result: BackendCallResult): string | undefined {
	return result.status === "rejected" ? result.rejection.code : undefined;
}

const tools = (change?: { rowId: string; actionId: string }) =>
	world.call({ kind: "custom_tools", ...(change && { change }) });
const tool = (toolId?: string, change?: EditableFileChange) =>
	world.call({ kind: "custom_tool", ...(toolId && { toolId }), ...(change && { change }) });

describe("without the custom tools port", () => {
	test("both ops are unsupported", async () => {
		world = opsWorld();
		expect(codeOf(await tools())).toBe("unsupported");
		expect(codeOf(await tool("x"))).toBe("unsupported");
		expect(codeOf(await tool())).toBe("unsupported");
	});
});

describe("custom_tools", () => {
	test("one row per tool, with test and delete", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const list = listOf(await tools());
		expect(list.rows).toEqual([
			{
				id: "echo",
				title: "echo",
				subtitle: "Echoes its input",
				status: { label: "enabled", tone: "ok" },
				badges: ["builtin"],
				actions: [
					{ id: "test", label: "Test", destructive: false },
					{ id: "delete", label: "Delete", destructive: true },
				],
			},
		]);
	});

	test("a test puts its output in the note, a failed one says it failed", async () => {
		const port: CustomToolsPort = { ...memoryCustomTools(), test: async () => ({ ok: false, output: "HTTP 500" }) };
		world = opsWorld({ customTools: port });
		expect(listOf(await tools({ rowId: "echo", actionId: "test" })).note).toBe("Failed: HTTP 500");
		world.cleanup();
		world = opsWorld({ customTools: memoryCustomTools() });
		expect(listOf(await tools({ rowId: "echo", actionId: "test" })).note).toBe("echo: {}");
	});

	test("a port that throws during a test still answers, and delete removes the tool", async () => {
		const port: CustomToolsPort = {
			...memoryCustomTools(),
			test: async () => Promise.reject(new Error("script missing")),
		};
		world = opsWorld({ customTools: port });
		expect(listOf(await tools({ rowId: "echo", actionId: "test" })).note).toBe("Failed: script missing");
		world.cleanup();
		world = opsWorld({ customTools: memoryCustomTools() });
		const after = listOf(await tools({ rowId: "echo", actionId: "delete" }));
		expect(after.rows).toEqual([]);
		expect(after.note).toBe("Deleted echo.");
	});

	test("an unknown row is not_found and an action the row does not offer is invalid_input", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		expect(codeOf(await tools({ rowId: "nope", actionId: "test" }))).toBe("not_found");
		expect(codeOf(await tools({ rowId: "echo", actionId: "enable" }))).toBe("invalid_input");
	});
});

describe("custom_tool", () => {
	test("reads a definition as JSON text with a revision", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		expect(file).toMatchObject({
			id: "echo",
			format: "json",
			exists: true,
			editable: true,
			truncated: false,
			problems: [],
		});
		expect(JSON.parse(file.text)).toEqual({ name: "echo", description: "Echoes its input", enabled: true });
		expect(file.revision).toBe(revisionOfText(file.text));
	});

	test("no toolId answers a starting template under an id nobody has, and a write to it creates the tool", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const template = fileOf(await tool());
		expect(template).toMatchObject({ exists: false, revision: ABSENT_REVISION, editable: true });
		expect(fileOf(await tool(template.id)).exists).toBe(false);
		const text = JSON.stringify({ name: "ping", description: "Pings", enabled: true });
		const created = fileOf(await tool(template.id, { kind: "write", text, revision: template.revision }));
		expect(created).toMatchObject({ exists: true, id: template.id });
		expect(JSON.parse(created.text).name).toBe("ping");
		expect(listOf(await tools()).rows.map((row) => row.title)).toEqual(["echo", "ping"]);
	});

	test("an id no tool has and no template named is not_found", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		expect(codeOf(await tool("conformance-no-such-file"))).toBe("not_found");
		const write: EditableFileChange = { kind: "write", text: "{}", revision: ABSENT_REVISION };
		expect(codeOf(await tool("conformance-no-such-file", write))).toBe("not_found");
		expect(codeOf(await tool(undefined, write))).toBe("invalid_input");
	});

	test("a write at another revision is stale; JSON that does not parse is invalid_input; neither changes the tool", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		const attempt = (text: string, revision: string) => tool("echo", { kind: "write", text, revision });
		expect(codeOf(await attempt(file.text, "conformance-another-revision"))).toBe("stale");
		for (const text of ["{", "", "[]", '{"name":"x",}'])
			expect(codeOf(await attempt(text, file.revision))).toBe("invalid_input");
		expect(fileOf(await tool("echo"))).toEqual(file);
	});

	test("a definition the port finds invalid is invalid_input with its reasons", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		const refused = await tool("echo", { kind: "write", text: '{"description":"no name"}', revision: file.revision });
		expect(refused.status === "rejected" && refused.rejection).toEqual({
			code: "invalid_input",
			message: "not a valid tool: a tool needs a name",
		});
		expect(fileOf(await tool("echo"))).toEqual(file);
	});

	test("writing back what was read answers the same text", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		const kept = fileOf(await tool("echo", { kind: "write", text: file.text, revision: file.revision }));
		expect(kept.text).toBe(file.text);
	});

	test("two writes at one revision: one lands, the other is stale", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		const write = (name: string) =>
			tool("echo", { kind: "write", text: JSON.stringify({ name }), revision: file.revision });
		const results = await Promise.all([write("one"), write("two")]);
		expect(results.map(codeOf).filter((code) => code === "stale")).toHaveLength(1);
		expect(results.filter((result) => result.status === "accepted")).toHaveLength(1);
	});

	test("a definition longer than the phone can show is truncated and never written back", async () => {
		const big = { name: "big", blob: "a".repeat(1_100_000) };
		const saved: unknown[] = [];
		const port: CustomToolsPort = {
			...memoryCustomTools(),
			read: async () => big,
			save: async (_id, definition) => {
				saved.push(definition);
				return { ok: true };
			},
		};
		world = opsWorld({ customTools: port });
		const file = fileOf(await tool("big"));
		expect(file).toMatchObject({ truncated: true, editable: false });
		expect(file.text.length).toBe(1_048_576);
		const refused = await tool("big", { kind: "write", text: "{}", revision: file.revision });
		expect(codeOf(refused)).toBe("unsupported");
		expect(saved).toEqual([]);
	});

	test("delete is compare-and-swap, and a deleted tool reads as absent", async () => {
		world = opsWorld({ customTools: memoryCustomTools() });
		const file = fileOf(await tool("echo"));
		expect(codeOf(await tool("echo", { kind: "delete", revision: "conformance-another-revision" }))).toBe("stale");
		const gone = fileOf(await tool("echo", { kind: "delete", revision: file.revision }));
		expect(gone).toMatchObject({ id: "echo", exists: false, revision: ABSENT_REVISION });
		expect(codeOf(await tool("echo", { kind: "delete", revision: file.revision }))).toBe("not_found");
	});
});
