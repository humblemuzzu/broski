/** `plugins`: `enabledPlugins` from the real settings cascade, changed in local settings, reloaded in a live session. */

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionList, BackendCallResult } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

const localPath = () => join(world.cwd, ".claude", "settings.local.json");

function listOf(result: BackendCallResult): ActionList {
	if (result.status !== "accepted" || result.result.kind !== "plugins") throw new Error(JSON.stringify(result));
	return result.result.list;
}

function codeOf(result: BackendCallResult): string | undefined {
	return result.status === "rejected" ? result.rejection.code : undefined;
}

function plugins(change?: { rowId: string; actionId: string }, sessionId?: string) {
	return world.call({ kind: "plugins", cwd: world.cwd, ...(sessionId && { sessionId }), ...(change && { change }) });
}

function seed(): void {
	const user = { enabledPlugins: { "fmt@tools": true, "lint@tools": false } };
	world.write(join(world.configDir, "settings.json"), JSON.stringify(user));
	world.write(join(world.cwd, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "deploy@team": true } }));
}

describe("plugins: the list", () => {
	test("one row per plugin enabledPlugins names, with its state, its tier and the action it offers", async () => {
		world = opsWorld();
		seed();
		const list = listOf(await plugins());
		const rows = new Map(list.rows.map((row) => [row.id, row]));
		expect(rows.get("fmt@tools")).toMatchObject({
			title: "fmt",
			group: "tools",
			status: { label: "enabled", tone: "ok" },
			badges: ["set in user settings"],
			actions: [{ id: "disable", destructive: false }],
		});
		expect(rows.get("lint@tools")).toMatchObject({ status: { label: "disabled" }, actions: [{ id: "enable" }] });
		expect(rows.get("deploy@team")?.badges).toEqual(["set in project settings"]);
		expect(list.note).toContain("claude plugin");
	});

	test("an empty cascade is an empty list, not an error", async () => {
		world = opsWorld();
		expect(listOf(await plugins()).rows).toEqual([]);
	});

	test("a plugin whose value is a version list is enabled and says so", async () => {
		world = opsWorld();
		world.write(join(world.configDir, "settings.json"), JSON.stringify({ enabledPlugins: { "pin@m": ["1.2.0"] } }));
		const row = listOf(await plugins()).rows[0];
		expect(row).toMatchObject({ status: { label: "enabled" }, subtitle: "Enabled with version constraints" });
	});
});

describe("plugins: enabling and disabling", () => {
	test("disabling writes false in LOCAL settings, which beats the project's true, and keeps every other key", async () => {
		world = opsWorld();
		seed();
		world.write(localPath(), '{\n\t"outputStyle": "Concise",\n\t"permissions": {"deny": ["Bash(rm *)"]}\n}\n');
		const list = listOf(await plugins({ rowId: "deploy@team", actionId: "disable" }));
		expect(list.rows.find((row) => row.id === "deploy@team")).toMatchObject({
			status: { label: "disabled" },
			badges: ["set in local settings"],
			actions: [{ id: "enable" }],
		});
		const written = JSON.parse(readFileSync(localPath(), "utf8"));
		expect(written).toEqual({
			outputStyle: "Concise",
			permissions: { deny: ["Bash(rm *)"] },
			enabledPlugins: { "deploy@team": false },
		});
		expect(Object.keys(written)).toEqual(["outputStyle", "permissions", "enabledPlugins"]);
		expect(readFileSync(localPath(), "utf8")).toStartWith('{\n\t"outputStyle"');
		const project = JSON.parse(readFileSync(join(world.cwd, ".claude", "settings.json"), "utf8"));
		expect(project.enabledPlugins["deploy@team"]).toBe(true);
	});

	test("a settings file written on one line stays on one line, and an empty one gets two-space indentation", async () => {
		world = opsWorld();
		seed();
		world.write(localPath(), '{"outputStyle":"Concise"}\n');
		await plugins({ rowId: "fmt@tools", actionId: "disable" });
		expect(readFileSync(localPath(), "utf8")).toBe('{"outputStyle":"Concise","enabledPlugins":{"fmt@tools":false}}\n');
		world.write(localPath(), "{}\n");
		await plugins({ rowId: "lint@tools", actionId: "enable" });
		expect(readFileSync(localPath(), "utf8")).toBe('{\n  "enabledPlugins": {\n    "lint@tools": true\n  }\n}\n');
	});

	test("enabling creates local settings when there are none", async () => {
		world = opsWorld();
		seed();
		const list = listOf(await plugins({ rowId: "lint@tools", actionId: "enable" }));
		expect(list.rows.find((row) => row.id === "lint@tools")?.status?.label).toBe("enabled");
		expect(JSON.parse(readFileSync(localPath(), "utf8"))).toEqual({ enabledPlugins: { "lint@tools": true } });
		expect(world.invalidated).toEqual([world.cwd]);
	});

	test("an unknown row is not_found and an action the row does not offer is invalid_input; nothing is written", async () => {
		world = opsWorld();
		seed();
		expect(codeOf(await plugins({ rowId: "nope@x", actionId: "enable" }))).toBe("not_found");
		expect(codeOf(await plugins({ rowId: "fmt@tools", actionId: "enable" }))).toBe("invalid_input");
		expect(codeOf(await plugins({ rowId: "fmt@tools", actionId: "reinstall" }))).toBe("invalid_input");
		expect(existsSync(localPath())).toBe(false);
	});

	test("a local settings file that does not parse is never repaired or replaced", async () => {
		world = opsWorld();
		seed();
		world.write(localPath(), '{"permissions":{"allow":["Bash(ls)"],},}');
		const refused = await plugins({ rowId: "fmt@tools", actionId: "disable" });
		expect(codeOf(refused)).toBe("invalid_input");
		expect(readFileSync(localPath(), "utf8")).toBe('{"permissions":{"allow":["Bash(ls)"],},}');
	});

	test("a local file Claude Code already skips for its schema is not edited either", async () => {
		world = opsWorld();
		seed();
		world.write(localPath(), '{"model":5}');
		const refused = await plugins({ rowId: "fmt@tools", actionId: "disable" });
		expect(codeOf(refused)).toBe("invalid_input");
		expect(readFileSync(localPath(), "utf8")).toBe('{"model":5}');
	});

	test("a local entry with version constraints is not overwritten by a disable", async () => {
		world = opsWorld();
		world.write(localPath(), JSON.stringify({ enabledPlugins: { "pin@m": ["1.2.0"] } }));
		const refused = await plugins({ rowId: "pin@m", actionId: "disable" });
		expect(codeOf(refused)).toBe("unsupported");
		expect(JSON.parse(readFileSync(localPath(), "utf8"))).toEqual({ enabledPlugins: { "pin@m": ["1.2.0"] } });
	});

	test("a __proto__ key elsewhere in the file survives the rewrite and pollutes nothing", async () => {
		world = opsWorld();
		seed();
		world.write(localPath(), '{"__proto__":{"polluted":true},"outputStyle":"Concise"}');
		await plugins({ rowId: "fmt@tools", actionId: "disable" });
		const text = readFileSync(localPath(), "utf8");
		expect(text).toContain('"__proto__"');
		expect(JSON.parse(text).enabledPlugins).toEqual({ "fmt@tools": false });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});
});

describe("plugins: a live session", () => {
	const reload =
		(count: number, errors = 0) =>
		async () => ({
			commands: [],
			agents: [],
			plugins: Array.from({ length: count }, (_, index) => ({ name: `p${index}`, path: "/x" })),
			mcpServers: [],
			error_count: errors,
		});

	test("reloads plugins in the session's host after the write", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ reloadPlugins: reload(2) });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		seed();
		const list = listOf(await plugins({ rowId: "fmt@tools", actionId: "disable" }, sessionId));
		expect(query.calls).toEqual([{ method: "reloadPlugins", args: [{ holdOnCacheImpact: false }] }]);
		expect(list.note).toBe("Saved and reloaded in the running session (2 plugins).");
	});

	test("a busy session only reloads when that does not change its tool list, and says when it held", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ reloadPlugins: async () => ({ ...(await reload(1)()), held: true }) });
		world = opsWorld({ hosts: { [sessionId]: { query, busy: true } } });
		seed();
		const list = listOf(await plugins({ rowId: "fmt@tools", actionId: "disable" }, sessionId));
		expect(query.calls[0]?.args).toEqual([{ holdOnCacheImpact: true }]);
		expect(list.note).toContain("keeps its plugins until its next start");
	});

	test("a reload that fails still reports the saved change", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ reloadPlugins: async () => Promise.reject(new Error("boom")) });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		seed();
		const list = listOf(await plugins({ rowId: "fmt@tools", actionId: "disable" }, sessionId));
		expect(list.note).toBe("Saved. The running session could not reload plugins: boom");
		expect(JSON.parse(readFileSync(localPath(), "utf8")).enabledPlugins["fmt@tools"]).toBe(false);
	});

	test("a session nobody hosts only gets the file change; an unknown session is not_found and writes nothing", async () => {
		const known = randomUUID();
		world = opsWorld({ hosts: { [known]: "idle" } });
		seed();
		const saved = listOf(await plugins({ rowId: "fmt@tools", actionId: "disable" }, known));
		expect(saved.note).toContain("applies when a session next starts");
		const unknown = await plugins({ rowId: "lint@tools", actionId: "enable" }, randomUUID());
		expect(codeOf(unknown)).toBe("not_found");
		expect(JSON.parse(readFileSync(localPath(), "utf8")).enabledPlugins).toEqual({ "fmt@tools": false });
	});
});
