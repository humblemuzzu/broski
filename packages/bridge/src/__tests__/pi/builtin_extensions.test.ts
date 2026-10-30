/**
 * The extensions a hosted session loads (D15): the three built-ins the `pi` command declares,
 * loaded the way it loads them, and the hidden gate after them.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { builtinExtensions, sessionExtensions } from "../../backends/pi/ui/extensions";
import { useWatchdog } from "./helpers/use-watchdog";
import { createRig, type Rig } from "./ui_rig";

useWatchdog();

let rig: Rig | undefined;

afterEach(async () => {
	await rig?.dispose();
	rig = undefined;
});

function loaded(r: Rig) {
	const result = r.runtime.services.resourceLoader.getExtensions();
	return { ...result, byPath: new Map(result.extensions.map((extension) => [extension.path, extension])) };
}

describe("what the adapter declares", () => {
	test("the CLI's three loadable built-ins, flagged as it flags them", () => {
		const flags = builtinExtensions().map((extension) =>
			typeof extension === "function"
				? extension
				: { name: extension.name, builtin: extension.builtin, replaceable: extension.replaceable },
		);
		expect(flags).toEqual([
			{ name: "codemode", builtin: true, replaceable: true },
			{ name: "tool-search", builtin: true, replaceable: true },
			{ name: "mcp", builtin: true, replaceable: true },
		]);
	});

	test("a session gets them fresh each time, then its gate last", () => {
		const gate: InlineExtension = { name: "gate", factory: () => {} };
		const first = sessionExtensions(gate);
		const second = sessionExtensions(gate);
		expect(first.map((extension) => (typeof extension === "function" ? "?" : extension.name))).toEqual([
			"codemode",
			"tool-search",
			"mcp",
			"gate",
		]);
		expect(first.at(-1)).toBe(gate);
		const factories = (list: typeof first) =>
			list.slice(0, 3).map((extension) => (typeof extension === "function" ? extension : extension.factory));
		for (const [index, factory] of factories(first).entries()) expect(factory).not.toBe(factories(second)[index]);
	});
});

describe("in an SDK host", () => {
	test("the built-ins load with no errors, add codemode, tool_search and /mcp, and codemode is not active by default", async () => {
		rig = await createRig();
		await rig.bind();
		const { errors, byPath } = loaded(rig);
		expect(errors).toEqual([]);
		expect([...byPath.keys()]).toEqual([
			"builtin:codemode",
			"builtin:tool-search",
			"builtin:mcp",
			"<inline:broski-permissions>",
		]);
		expect([...byPath.values()].every((extension) => extension.hidden)).toBe(true);
		const tools = rig.session.getAllTools().map((tool) => tool.name);
		expect(tools).toContain("codemode");
		expect(tools).toContain("tool_search");
		expect(rig.session.extensionRunner.getCommand("mcp")).toBeDefined();
		expect(rig.session.getActiveToolNames()).not.toContain("codemode");
		expect(rig.errors).toEqual([]);
	});

	test("the user's own settings switch a built-in off, as in the terminal", async () => {
		rig = await createRig({
			beforeHost: (env) =>
				writeFileSync(join(env.agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:codemode"] })),
		});
		await rig.bind();
		expect(rig.session.getAllTools().map((tool) => tool.name)).not.toContain("codemode");
		expect(loaded(rig).byPath.has("builtin:mcp")).toBe(true);
	});

	test("an extension that registers /mcp takes the built-in's place", async () => {
		const mine: InlineExtension = {
			name: "my-mcp",
			factory: (pi) => pi.registerCommand("mcp", { description: "mine", handler: async () => {} }),
		};
		rig = await createRig({ extensions: [mine] });
		await rig.bind();
		const { byPath } = loaded(rig);
		expect(byPath.has("builtin:mcp")).toBe(false);
		expect(byPath.has("<inline:my-mcp>")).toBe(true);
	});

	test("a user's own extension file loads before the gate, so its tool_call handler runs first", async () => {
		rig = await createRig({
			beforeHost: (env) => {
				mkdirSync(join(env.agentDir, "extensions"), { recursive: true });
				writeFileSync(
					join(env.agentDir, "extensions", "early.ts"),
					"export default function (pi) { pi.on('session_start', () => {}); }\n",
				);
			},
		});
		await rig.bind();
		const paths = [...loaded(rig).byPath.keys()];
		const early = paths.findIndex((path) => path.endsWith("early.ts"));
		expect(early).toBeGreaterThanOrEqual(0);
		expect(early).toBeLessThan(paths.indexOf("<inline:broski-permissions>"));
	});
});
