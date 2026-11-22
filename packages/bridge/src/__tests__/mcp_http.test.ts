/**
 * The MCP server's transport on a real port: who it answers, what it refuses, the protocol methods, and the tool list
 * each token sees, which never changes under it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { MAX_MCP_REQUEST_BYTES } from "../mcp";
import { callOf, McpRig } from "./helpers/mcp-rig";

let rig: McpRig | undefined;

afterEach(() => {
	rig?.stop();
	rig = undefined;
});

function started(): McpRig {
	rig = new McpRig();
	return rig;
}

const PING = { jsonrpc: "2.0", id: 1, method: "ping" };

function toolNames(result: Record<string, unknown> | undefined): unknown[] {
	const tools = result?.tools;
	return Array.isArray(tools) ? tools.map((tool) => tool.name) : [];
}

describe("who the server answers", () => {
	test("no token, a wrong token, another scheme and a revoked token are all 401", async () => {
		const t = started();
		const credential = t.issue();
		expect((await t.post(undefined, PING)).status).toBe(401);
		expect((await t.post("f".repeat(64), PING)).status).toBe(401);
		const basic = await t.post(undefined, PING, { authorization: `Basic ${credential.token}` });
		expect(basic.status).toBe(401);
		expect(basic.headers.get("www-authenticate")).toBe("Bearer");
		expect((await t.post(credential.token, PING)).status).toBe(200);
		credential.revoke();
		expect((await t.post(credential.token, PING)).status).toBe(401);
	});

	test("only POST is served", async () => {
		const t = started();
		const { token } = t.issue();
		for (const method of ["GET", "DELETE", "PUT"]) {
			const response = await fetch(t.url, { method, headers: { authorization: `Bearer ${token}` } });
			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("POST");
		}
	});

	test("an oversized body is 413, broken JSON 400, an unknown protocol version 400", async () => {
		const t = started();
		const { token } = t.issue();
		expect((await t.post(token, "x".repeat(MAX_MCP_REQUEST_BYTES + 1))).status).toBe(413);
		const broken = await t.post(token, "{not json");
		expect(broken.status).toBe(400);
		expect(((await broken.json()) as { error: { code: number } }).error.code).toBe(-32700);
		expect((await t.post(token, PING, { "mcp-protocol-version": "2024-01-01" })).status).toBe(400);
		expect((await t.post(token, PING, { "mcp-protocol-version": "2025-03-26" })).status).toBe(400);
		expect((await t.post(token, [PING])).status).toBe(400);
	});
});

describe("the protocol", () => {
	test.each(["2025-06-18", "2025-03-26", "2099-01-01"])(
		"initialize answers 2025-06-18, the version without batches, to a client asking for %s",
		async (version) => {
			const t = started();
			const { token } = t.issue();
			const reply = await t.rpc(token, "initialize", {
				protocolVersion: version,
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			});
			expect(reply.result).toEqual({
				protocolVersion: "2025-06-18",
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "broski", version: "9.9.9" },
			});
		},
	);

	test("a request whose id is out of bounds or not an integer is refused, never taken for a notification", async () => {
		const t = started();
		const { token } = t.issue({ notify: true });
		for (const id of ["i".repeat(300), 1.5, null, true]) {
			const call = { ...callOf("broski_notify", { title: "hi" }), id };
			const response = await t.post(token, call, { accept: "application/json" });
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32600);
		}
		expect(t.sink.notices).toEqual([]);
	});

	test("notifications and client responses are accepted with no body; ping answers; unknown methods are -32601", async () => {
		const t = started();
		const { token } = t.issue();
		const initialized = await t.post(token, { jsonrpc: "2.0", method: "notifications/initialized" });
		expect(initialized.status).toBe(202);
		expect(await initialized.text()).toBe("");
		expect((await t.post(token, { jsonrpc: "2.0", id: 3, result: {} })).status).toBe(202);
		expect((await t.rpc(token, "ping")).result).toEqual({});
		expect((await t.rpc(token, "resources/list")).error?.code).toBe(-32601);
	});
});

describe("the tool list", () => {
	test("each token lists only the tools it was given, in a fixed order", async () => {
		const t = started();
		expect(toolNames((await t.rpc(t.issue().token, "tools/list")).result)).toEqual([
			"broski_ask",
			"broski_propose_plan",
			"broski_notify",
		]);
		const claudeCode = t.issue({ notify: true });
		expect(toolNames((await t.rpc(claudeCode.token, "tools/list")).result)).toEqual(["broski_notify"]);
		expect(toolNames((await t.rpc(t.issue({}).token, "tools/list")).result)).toEqual([]);
	});

	test("a tool the token was not given cannot be called", async () => {
		const t = started();
		const { token } = t.issue({ notify: true });
		const response = await t.post(token, callOf("broski_ask", { title: "x", questions: [] }), {
			accept: "application/json",
		});
		expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32602);
		expect(t.sink.raised).toHaveLength(0);
	});

	test("the list is the same bytes on every call, so a client's prompt cache stays warm", async () => {
		const t = started();
		const { token } = t.issue();
		const list = async () => (await t.post(token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).text();
		const first = await list();
		await t.rpc(token, "tools/call", callOf("broski_notify", { title: "hi" }).params);
		expect(await list()).toBe(first);
	});

	test("every tool is read-only, closed-world and always loaded, and what the model reads of them stays small", async () => {
		const t = started();
		const { result } = await t.rpc(t.issue().token, "tools/list");
		const tools = (result?.tools ?? []) as Record<string, unknown>[];
		for (const tool of tools) {
			expect(tool.annotations).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			});
			expect(tool._meta).toEqual({ "anthropic/alwaysLoad": true });
		}
		const modelSees = (tool: Record<string, unknown>) =>
			JSON.stringify({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }).length;
		const sizes = tools.map(modelSees);
		expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(1_150);
		expect(sizes[2]).toBeLessThanOrEqual(260);
	});
});
