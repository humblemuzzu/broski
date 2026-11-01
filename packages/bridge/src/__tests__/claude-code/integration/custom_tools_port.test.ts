/** D30: the server layer's custom tools port over a store in memory, its deletes to a trash under a temp HOME. */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trashTargetOf } from "../../../backends/claude-code/trash";
import type { CustomToolDefinition } from "../../../custom-tools";
import { CUSTOM_TOOLS_SERVER, type CustomToolStore, createCustomToolsPort } from "../../../server/cc-custom-tools";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const WEATHER = {
	name: "weather",
	description: "Today's weather",
	parameters: [{ name: "city", type: "string" }],
	handler: "http",
	handlerConfig: { url: "https://example.com/{{city}}", method: "GET" },
	enabled: true,
};

function world(platform: NodeJS.Platform = process.platform) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-tools-")));
	roots.push(root);
	const tools: CustomToolDefinition[] = [];
	let next = 0;
	const store: CustomToolStore = {
		all: async () => tools,
		save: async (tool) => {
			const at = tools.findIndex((kept) => kept.id === tool.id);
			if (at >= 0) tools[at] = tool;
			else tools.push(tool);
		},
		delete: async (toolId) => {
			const at = tools.findIndex((kept) => kept.id === toolId);
			if (at < 0) return false;
			tools.splice(at, 1);
			return true;
		},
		test: async (tool) => ({ success: true, result: `ran ${tool.name}` }),
		server: async () => (tools.some((tool) => tool.enabled) ? { type: "stdio", command: "true" } : null),
		newId: () => `tool_${++next}`,
	};
	const home = join(root, "home");
	const port = createCustomToolsPort({
		store,
		stagingDir: join(home, ".broski", "claude-code", "trash-staging"),
		trash: () => trashTargetOf({ HOME: home }, new Date(), platform),
	});
	const trashed = () => {
		const dir = platform === "darwin" ? join(home, ".Trash") : join(home, ".local", "share", "Trash", "files");
		return existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)) : [];
	};
	return { port, tools, trashed };
}

describe("the custom tools port", () => {
	test("a template is saved under its id, listed, read back and served as the session's MCP server", async () => {
		const { port } = world();
		expect(await port.sessionServers()).toEqual({});
		const template = port.template();
		expect(await port.save(template.toolId, WEATHER)).toEqual({ ok: true });
		expect(await port.list()).toEqual([
			{ toolId: template.toolId, name: "weather", description: "Today's weather", enabled: true, handler: "http" },
		]);
		expect(await port.read(template.toolId)).toEqual(WEATHER);
		expect(Object.keys(await port.sessionServers())).toEqual([CUSTOM_TOOLS_SERVER]);
		expect(await port.test(template.toolId)).toEqual({ ok: true, output: "ran weather" });
	});

	test("a definition that is not a tool is refused with what is wrong, and nothing is saved", async () => {
		const { port, tools } = world();
		const wrong = await port.save("tool_x", { ...WEATHER, handler: "ftp" });
		expect(wrong.ok).toBe(false);
		const badName = await port.save("tool_x", { ...WEATHER, name: "has spaces" });
		expect(badName).toMatchObject({ ok: false, problems: [expect.stringContaining("Tool name")] });
		expect(tools).toEqual([]);
	});

	for (const platform of ["darwin", "linux"] as const) {
		test(`a delete puts the definition in the ${platform} trash as a file before it leaves the store`, async () => {
			const { port, tools, trashed } = world(platform);
			await port.save("tool_1", WEATHER);
			expect(await port.remove("tool_1")).toBe(true);
			expect(tools).toEqual([]);
			const [file] = trashed();
			expect(JSON.parse(readFileSync(file ?? "", "utf8"))).toMatchObject({ name: "weather", id: "tool_1" });
			expect(await port.remove("tool_1")).toBe(false);
		});
	}

	test("a delete the trash cannot take keeps the tool and says why", async () => {
		const { port, tools } = world("win32");
		await port.save("tool_1", WEATHER);
		const failed = await port.remove("tool_1").then(
			() => "removed",
			(error: unknown) => String(error),
		);
		expect(failed).toContain("not supported");
		expect(tools).toHaveLength(1);
	});
});
