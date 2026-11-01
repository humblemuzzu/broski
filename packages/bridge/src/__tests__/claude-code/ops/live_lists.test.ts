/** `mcp_servers`, `tasks` and `context_usage`: live state by session, actions on rows, and the refusals around them. */

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServerStatus, SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { BackgroundTask } from "../../../backends/claude-code/ports";
import type { ActionList, BackendCallResult, ClaudeCodeOp } from "../../../contract";
import { FakeQuery } from "../helpers/fake-query";
import { type OpsWorld, opsWorld } from "./ops-world";

let world: OpsWorld;

afterEach(() => world.cleanup());

function listOf(result: BackendCallResult): ActionList {
	if (result.status !== "accepted" || !("list" in result.result)) throw new Error(JSON.stringify(result));
	return result.result.list;
}

function codeOf(result: BackendCallResult): string | undefined {
	return result.status === "rejected" ? result.rejection.code : undefined;
}

const SERVERS: McpServerStatus[] = [
	{
		name: "elicit",
		status: "connected",
		scope: "user",
		source: "user",
		serverInfo: { name: "elicit", version: "1.0.0" },
		tools: [{ name: "a" }, { name: "b" }],
		config: { type: "stdio", command: "/usr/local/bin/node", args: ["--token=secret-arg"] },
	},
	{
		name: "remote",
		status: "failed",
		error: "connect ECONNREFUSED",
		scope: "project",
		source: "project",
		config: { type: "http", url: "https://api.example.com/mcp?key=secret-key" },
	},
	{ name: "off", status: "disabled", scope: "local", source: "local" },
	{ name: "auth", status: "needs-auth", scope: "user", source: "user" },
	{ name: "slow", status: "pending", source: "plugin" },
	{ name: "corp", status: "connected", source: "managed" },
];

function mcp(sessionId: string, change?: { rowId: string; actionId: string }): Promise<BackendCallResult> {
	const op: ClaudeCodeOp = { kind: "mcp_servers", sessionId, ...(change && { change }) };
	return world.call(op);
}

describe("mcp_servers", () => {
	test("one row per server with its live state, what it offers, and no credential in the text", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ mcpServerStatus: async () => SERVERS });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		const list = listOf(await mcp(sessionId));
		const rows = new Map(list.rows.map((row) => [row.id, row]));
		expect(rows.get("elicit")).toMatchObject({
			status: { label: "connected", tone: "ok" },
			group: "User",
			subtitle: "stdio node · elicit 1.0.0 · 2 tools",
			actions: [{ id: "reconnect" }, { id: "disable" }],
		});
		expect(rows.get("remote")).toMatchObject({
			status: { tone: "error" },
			subtitle: "connect ECONNREFUSED",
			group: "Project (.mcp.json)",
			actions: [{ id: "reconnect" }, { id: "disable" }],
		});
		expect(rows.get("off")).toMatchObject({
			status: { label: "disabled", tone: "neutral" },
			actions: [{ id: "enable" }],
		});
		expect(rows.get("auth")).toMatchObject({
			status: { label: "needs sign-in", tone: "warning" },
			actions: [{ id: "disable" }],
		});
		expect(rows.get("auth")?.subtitle).toContain("terminal");
		expect(rows.get("slow")).toMatchObject({ status: { tone: "busy" }, group: "Plugins" });
		expect(rows.get("corp")).toMatchObject({ badges: ["managed by policy"], actions: [{ id: "reconnect" }] });
		expect(JSON.stringify(list)).not.toContain("secret-arg");
		expect(JSON.stringify(list)).not.toContain("secret-key");
		expect(rows.get("remote")?.group).toBe("Project (.mcp.json)");
	});

	test("enable, disable and reconnect go to the host, and nothing is written to the CLI's own config", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			mcpServerStatus: async () => SERVERS,
			toggleMcpServer: async () => undefined,
			reconnectMcpServer: async () => undefined,
		});
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		const enabled = listOf(await mcp(sessionId, { rowId: "off", actionId: "enable" }));
		expect(enabled.note).toBe("off enabled for this project.");
		await mcp(sessionId, { rowId: "elicit", actionId: "disable" });
		const reconnected = listOf(await mcp(sessionId, { rowId: "remote", actionId: "reconnect" }));
		expect(reconnected.note).toBe("Reconnecting remote.");
		const calls = query.calls.filter((call) => call.method !== "mcpServerStatus");
		expect(calls).toEqual([
			{ method: "toggleMcpServer", args: ["off", true] },
			{ method: "toggleMcpServer", args: ["elicit", false] },
			{ method: "reconnectMcpServer", args: ["remote"] },
		]);
		expect(existsSync(join(world.configDir, ".claude.json"))).toBe(false);
		expect(existsSync(join(world.root, "home", ".claude.json"))).toBe(false);
	});

	test("an unknown row is not_found, an action the row does not offer is invalid_input, and nothing reaches the host", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ mcpServerStatus: async () => SERVERS });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		expect(codeOf(await mcp(sessionId, { rowId: "nope", actionId: "enable" }))).toBe("not_found");
		expect(codeOf(await mcp(sessionId, { rowId: "elicit", actionId: "enable" }))).toBe("invalid_input");
		expect(codeOf(await mcp(sessionId, { rowId: "auth", actionId: "reconnect" }))).toBe("invalid_input");
		expect(codeOf(await mcp(sessionId, { rowId: "corp", actionId: "disable" }))).toBe("invalid_input");
		expect(query.calls.every((call) => call.method === "mcpServerStatus")).toBe(true);
	});

	test("a failure of the CLI is a rejection with its words, not a throw", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({
			mcpServerStatus: async () => SERVERS,
			toggleMcpServer: async () => Promise.reject(new Error("Server not found: off")),
		});
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		const result = await mcp(sessionId, { rowId: "off", actionId: "enable" });
		expect(result.status === "rejected" && result.rejection).toEqual({
			code: "backend_error",
			message: "enable off: Server not found: off",
		});
	});

	test("an unknown session is not_found; a session nobody hosts is read on a transient host", async () => {
		const idle = randomUUID();
		world = opsWorld({ hosts: { [idle]: "idle" } });
		expect(codeOf(await mcp(randomUUID()))).toBe("not_found");
		expect(world.transient).toHaveLength(0);
		const result = await mcp(idle);
		expect(result.status).toBe("rejected");
		expect(world.transient).toHaveLength(1);
	});
});

function task(taskId: string, status: BackgroundTask["status"], extra: Partial<BackgroundTask> = {}): BackgroundTask {
	return { taskId, description: `task ${taskId}`, status, ...extra };
}

describe("tasks", () => {
	function tasksOp(sessionId: string, change?: { rowId: string; actionId: string }) {
		return world.call({ kind: "tasks", sessionId, ...(change && { change }) });
	}

	test("rows from the host's task state, with Stop only on work that is still going", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery();
		const tasks = () => [
			task("a", "running", { taskType: "local_bash" }),
			task("b", "completed"),
			task("c", "paused"),
			task("d", "failed"),
			task("e", "killed"),
		];
		world = opsWorld({ hosts: { [sessionId]: { query, tasks } } });
		const list = listOf(await tasksOp(sessionId));
		const byId = new Map(list.rows.map((row) => [row.id, row]));
		expect(byId.get("a")).toMatchObject({
			title: "task a",
			status: { label: "running", tone: "busy" },
			badges: ["local_bash"],
			actions: [{ id: "stop", destructive: true }],
		});
		expect(byId.get("b")).toMatchObject({ status: { label: "done", tone: "ok" }, actions: [] });
		expect(byId.get("c")?.actions).toHaveLength(1);
		expect(byId.get("d")?.status?.tone).toBe("error");
		expect(byId.get("e")?.status).toEqual({ label: "stopped", tone: "neutral" });
	});

	test("stop reaches the host with the task id", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ stopTask: async () => undefined });
		world = opsWorld({
			hosts: { [sessionId]: { query, tasks: () => [task("a", "running"), task("b", "completed")] } },
		});
		const list = listOf(await tasksOp(sessionId, { rowId: "a", actionId: "stop" }));
		expect(query.calls).toEqual([{ method: "stopTask", args: ["a"] }]);
		expect(list.note).toBe("Asked task a to stop.");
		expect(codeOf(await tasksOp(sessionId, { rowId: "b", actionId: "stop" }))).toBe("invalid_input");
		expect(codeOf(await tasksOp(sessionId, { rowId: "zz", actionId: "stop" }))).toBe("not_found");
		expect(query.calls).toHaveLength(1);
	});

	test("a session nobody hosts has no tasks, and an unknown session is not_found", async () => {
		const idle = randomUUID();
		world = opsWorld({ hosts: { [idle]: "idle" } });
		const list = listOf(await tasksOp(idle));
		expect(list.rows).toEqual([]);
		expect(list.note).toContain("not open");
		expect(codeOf(await tasksOp(idle, { rowId: "a", actionId: "stop" }))).toBe("not_found");
		expect(codeOf(await tasksOp(randomUUID()))).toBe("not_found");
		expect(world.transient).toHaveLength(0);
	});

	test("a failed stop is a rejection with the CLI's words", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ stopTask: async () => Promise.reject(new Error("no such task")) });
		world = opsWorld({ hosts: { [sessionId]: { query, tasks: () => [task("a", "running")] } } });
		const result = await tasksOp(sessionId, { rowId: "a", actionId: "stop" });
		expect(result.status === "rejected" && result.rejection.code).toBe("backend_error");
	});
});

const USAGE: SDKControlGetContextUsageResponse = {
	categories: [
		{ id: "system_prompt", name: "System prompt", tokens: 1937, color: "x", kind: "used" },
		{
			id: "mcp_tools_deferred",
			name: "MCP tools (deferred)",
			tokens: 184,
			color: "x",
			kind: "deferred",
			isDeferred: true,
		},
		{ id: "autocompact_buffer", name: "Autocompact buffer", tokens: 33000, color: "x", kind: "buffer" },
		{ name: "Unlabelled", tokens: 5, color: "x", kind: "used" },
		{ id: "free_space", name: "Free space", tokens: 947726, color: "x", kind: "free" },
	],
	totalTokens: 19274,
	maxTokens: 1000000,
	rawMaxTokens: 1000000,
	percentage: 1.9,
	gridRows: [],
	model: "claude-opus-5-5",
	memoryFiles: [{ path: "/home/me/.claude/CLAUDE.md", type: "User", tokens: 120 }],
	mcpTools: [],
	agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 80 }],
	isAutoCompactEnabled: true,
	apiUsage: null,
};

describe("context_usage", () => {
	test("asks for the summary and shows one row per part, grouped by what it does to the window", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ getContextUsage: async () => USAGE });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		const list = listOf(await world.call({ kind: "context_usage", sessionId }));
		expect(query.calls).toEqual([{ method: "getContextUsage", args: [{ detail: "summary" }] }]);
		const byId = new Map(list.rows.map((row) => [row.id, row]));
		expect(byId.get("category:system_prompt")).toMatchObject({
			title: "System prompt",
			subtitle: "1,937 tokens",
			group: "In the window",
		});
		expect(byId.get("category:mcp_tools_deferred")?.group).toBe("Loaded on demand");
		expect(byId.get("category:autocompact_buffer")).toMatchObject({ group: "Reserved", status: { tone: "warning" } });
		expect(byId.get("category:3")?.title).toBe("Unlabelled");
		expect(byId.get("memory:0")).toMatchObject({ title: "CLAUDE.md", group: "Memory files", badges: ["User"] });
		expect(byId.get("agent:0")).toMatchObject({ title: "reviewer", badges: ["projectSettings"] });
		expect(list.note).toBe("19,274 of 1,000,000 tokens (2%) · claude-opus-5-5, auto-compact on");
		expect(list.rows.every((row) => row.actions.length === 0)).toBe(true);
	});

	test("an unknown session is not_found and a failing CLI is a rejection", async () => {
		const sessionId = randomUUID();
		const query = new FakeQuery({ getContextUsage: async () => Promise.reject(new Error("no")) });
		world = opsWorld({ hosts: { [sessionId]: { query } } });
		expect(codeOf(await world.call({ kind: "context_usage", sessionId: randomUUID() }))).toBe("not_found");
		expect(codeOf(await world.call({ kind: "context_usage", sessionId }))).toBe("backend_error");
	});
});
