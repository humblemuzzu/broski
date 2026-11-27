/**
 * The ACP client's JSON-RPC layer reading the records the protocol's own documentation shows, as written there
 * (agentclientprotocol.com/protocol/v1, and jsonrpc.org/specification for the envelopes ACP takes from JSON-RPC 2.0);
 * only a response's `id` is the one the bridge's request carried. None of these is a record agy wrote.
 */

import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import {
	AnyResult,
	InitializeResult,
	isOffered,
	ListSessionsResult,
	NewSessionResult,
	PromptResult,
	type SessionUpdate,
} from "../../backends/antigravity/acp/frames";
import { type AgentCall, JsonRpc, type RpcResult } from "../../backends/antigravity/acp/rpc";

/** Long enough for an answer the layer reads, short enough that one it cannot read fails the test, not the run. */
const DEADLINE_MS = 500;

function wire() {
	const faults: string[] = [];
	const sent: Array<{ readonly id?: number | string; readonly [key: string]: unknown }> = [];
	const rpc = new JsonRpc(
		"agy",
		(record) => sent.push(JSON.parse(record)),
		(message) => faults.push(message),
	);
	const updates: SessionUpdate[] = [];
	const calls: AgentCall[] = [];
	const writes = (record: object) => rpc.receive({ kind: "line", text: JSON.stringify(record) });
	const ask = <T>(method: string, schema: z.ZodType<T>, reply: object) => {
		const answer = rpc.request(method, {}, schema, DEADLINE_MS);
		writes({ ...reply, id: sent.at(-1)?.id });
		return answer;
	};
	const route = (sessionId: string) =>
		rpc.attach(sessionId, {
			update: (update) => updates.push(update),
			call: (call) => calls.push(call),
			fault: () => undefined,
		});
	return { rpc, faults, sent, updates, calls, writes, ask, route };
}

function accepted<T>(answer: RpcResult<T>): T {
	if (!answer.ok) throw new Error(answer.failure.message);
	return answer.result;
}

describe("ACP's documented responses", () => {
	test("initialize: the full example, and those offering only a session list or session close", async () => {
		const { ask, faults } = wire();
		// protocol/v1/initialization
		const full = await ask("initialize", InitializeResult, {
			jsonrpc: "2.0",
			id: 0,
			result: {
				protocolVersion: 1,
				agentCapabilities: {
					loadSession: true,
					promptCapabilities: { image: true, audio: true, embeddedContext: true },
					mcpCapabilities: { http: true, sse: true },
				},
				agentInfo: { name: "my-agent", title: "My Agent", version: "1.0.0" },
				authMethods: [],
			},
		});
		expect(accepted(full)).toEqual({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
		// protocol/v1/session-list, "Checking support"
		const lists = accepted(
			await ask("initialize", InitializeResult, {
				jsonrpc: "2.0",
				id: 0,
				result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {} } } },
			}),
		);
		expect(isOffered(lists.agentCapabilities?.sessionCapabilities?.list)).toBe(true);
		expect(isOffered(lists.agentCapabilities?.sessionCapabilities?.close)).toBe(false);
		// protocol/v1/session-setup, "Closing active sessions"
		const closes = accepted(
			await ask("initialize", InitializeResult, {
				jsonrpc: "2.0",
				id: 0,
				result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } } },
			}),
		);
		expect(isOffered(closes.agentCapabilities?.sessionCapabilities?.close)).toBe(true);
		expect(closes.agentCapabilities?.loadSession).toBeUndefined();
		expect(faults).toEqual([]);
	});

	test("session/new, session/load, session/list and session/prompt", async () => {
		const { ask, faults } = wire();
		// protocol/v1/session-setup, "Creating a session"
		const created = await ask("session/new", NewSessionResult, {
			jsonrpc: "2.0",
			id: 1,
			result: { sessionId: "sess_abc123def456" },
		});
		expect(accepted(created)).toEqual({ sessionId: "sess_abc123def456" });
		// protocol/v1/session-setup, "Loading a session"
		expect(await ask("session/load", AnyResult, { jsonrpc: "2.0", id: 1, result: {} })).toEqual({
			ok: true,
			result: {},
		});
		// protocol/v1/session-list, "Listing sessions"
		const listed = await ask("session/list", ListSessionsResult, {
			jsonrpc: "2.0",
			id: 2,
			result: {
				sessions: [
					{
						sessionId: "sess_abc123def456",
						cwd: "/home/user/project",
						title: "Implement session list API",
						updatedAt: "2025-10-29T14:22:15Z",
						_meta: { messageCount: 12, hasErrors: false },
					},
					{
						sessionId: "sess_xyz789ghi012",
						cwd: "/home/user/project",
						title: "Debug authentication flow",
						updatedAt: "2025-10-28T16:45:30Z",
					},
					{ sessionId: "sess_uvw345rst678", cwd: "/home/user/project", updatedAt: "2025-10-27T15:30:00Z" },
				],
				nextCursor: "eyJwYWdlIjogM30=",
			},
		});
		expect(accepted(listed).sessions.map((session) => session.sessionId)).toEqual([
			"sess_abc123def456",
			"sess_xyz789ghi012",
			"sess_uvw345rst678",
		]);
		expect(accepted(listed).nextCursor).toBe("eyJwYWdlIjogM30=");
		// protocol/v1/prompt-turn, "4. Check for completion"
		const ended = await ask("session/prompt", PromptResult, {
			jsonrpc: "2.0",
			id: 2,
			result: { stopReason: "end_turn" },
		});
		expect(accepted(ended)).toEqual({ stopReason: "end_turn" });
		expect(faults).toEqual([]);
	});

	test("a null result, and an error, each end the request they answer", async () => {
		const { ask, faults } = wire();
		// jsonrpc.org/specification §5: `result` is whatever the method returns, `null` included.
		expect(await ask("session/close", AnyResult, { jsonrpc: "2.0", id: 2, result: null })).toEqual({
			ok: true,
			result: null,
		});
		// jsonrpc.org/specification §7, "rpc call of non-existent method"
		const refused = await ask("session/fork", AnyResult, {
			jsonrpc: "2.0",
			error: { code: -32601, message: "Method not found" },
			id: "1",
		});
		expect(refused).toEqual({ ok: false, failure: { code: -32601, message: "Method not found" } });
		expect(faults).toEqual([]);
	});
});

describe("ACP's documented notifications and agent requests", () => {
	test("session/update records reach their session's route; kinds the client does not read pass", () => {
		const { writes, route, updates, faults } = wire();
		route("sess_789xyz");
		route("sess_abc123def456");
		// protocol/v1/session-setup, "Loading a session"
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_789xyz",
				update: {
					sessionUpdate: "user_message_chunk",
					messageId: "msg_user_8f7a1",
					content: { type: "text", text: "What's the capital of France?" },
				},
			},
		});
		// protocol/v1/prompt-turn, "3. Agent reports output"
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_abc123def456",
				update: {
					sessionUpdate: "plan",
					entries: [{ content: "Check for syntax errors", priority: "high", status: "pending" }],
				},
			},
		});
		// schema/v1/schema.json `ToolCall`: `toolCallId` and `title` are all a tool call must carry.
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_abc123def456",
				update: { sessionUpdate: "tool_call", toolCallId: "call_001", title: "Analyzing Python code" },
			},
		});
		// protocol/v1/prompt-turn, "5. Tool invocation and status reporting"
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_abc123def456",
				update: { sessionUpdate: "tool_call_update", toolCallId: "call_001", status: "in_progress" },
			},
		});
		// protocol/v1/prompt-turn, "Session usage updates"
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_abc123def456",
				update: { sessionUpdate: "usage_update", used: 53000, size: 200000, cost: { amount: 0.045, currency: "USD" } },
			},
		});
		// protocol/v1/session-list, "Updating session metadata"
		writes({
			jsonrpc: "2.0",
			method: "session/update",
			params: {
				sessionId: "sess_abc123def456",
				update: {
					sessionUpdate: "session_info_update",
					title: "Implement user authentication",
					_meta: { tags: ["feature", "auth"], priority: "high" },
				},
			},
		});
		expect(updates).toEqual([
			{ sessionUpdate: "user_message_chunk", content: { type: "text", text: "What's the capital of France?" } },
			{ sessionUpdate: "tool_call", toolCallId: "call_001", title: "Analyzing Python code" },
			{ sessionUpdate: "tool_call_update", toolCallId: "call_001", status: "in_progress" },
			{ sessionUpdate: "usage_update", used: 53000, size: 200000 },
			{ sessionUpdate: "session_info_update", title: "Implement user authentication" },
		]);
		expect(faults).toEqual([]);
	});

	test("a notification without params and a request without params are read as such", () => {
		const { writes, sent, faults } = wire();
		// jsonrpc.org/specification §7, a notification and "rpc call of non-existent method"
		writes({ jsonrpc: "2.0", method: "foobar" });
		writes({ jsonrpc: "2.0", method: "foobar", id: "1" });
		expect(sent).toEqual([
			{ jsonrpc: "2.0", id: "1", error: { code: -32601, message: "the client does not offer foobar" } },
		]);
		expect(faults).toEqual([]);
	});

	test("session/request_permission naming only the tool call's id, and a form elicitation", () => {
		const { writes, route, calls, sent, faults } = wire();
		route("sess_abc123def456");
		route("sess_abc123");
		// protocol/v1/tool-calls, "Requesting permission"
		writes({
			jsonrpc: "2.0",
			id: 5,
			method: "session/request_permission",
			params: {
				sessionId: "sess_abc123def456",
				toolCall: { toolCallId: "call_001" },
				options: [
					{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
					{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
				],
			},
		});
		// protocol/v1/elicitation, "Form mode"
		writes({
			jsonrpc: "2.0",
			id: 43,
			method: "elicitation/create",
			params: {
				sessionId: "sess_abc123",
				mode: "form",
				message: "How should I approach this refactoring?",
				requestedSchema: {
					type: "object",
					properties: { strategy: { type: "string", enum: ["conservative", "balanced", "aggressive"] } },
					required: ["strategy"],
				},
			},
		});
		expect(calls.map((call) => call.method)).toEqual(["session/request_permission", "elicitation/create"]);
		expect(calls[0]?.params).toEqual({
			sessionId: "sess_abc123def456",
			toolCall: { toolCallId: "call_001" },
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "reject-once", name: "Reject", kind: "reject_once" },
			],
		});
		expect(calls[1]?.params).toMatchObject({ sessionId: "sess_abc123", requestedSchema: { required: ["strategy"] } });
		expect(sent).toEqual([]);
		expect(faults).toEqual([]);
	});
});

describe("a response the bridge cannot read", () => {
	test("ends the request it answers at once, naming what was wrong, and is reported as a fault", async () => {
		const { rpc, writes, faults } = wire();
		const unreadableError = rpc.request("session/prompt", {}, PromptResult, Number.POSITIVE_INFINITY);
		writes({ jsonrpc: "2.0", id: 1, error: { code: "busy", detail: "no message" } });
		const unreadableResult = rpc.request("session/new", {}, NewSessionResult, Number.POSITIVE_INFINITY);
		writes({ jsonrpc: "2.0", id: 2, result: { session: "sess_abc123def456" } });
		const empty = rpc.request("session/list", {}, ListSessionsResult, Number.POSITIVE_INFINITY);
		writes({ jsonrpc: "2.0", id: 3 });
		const failures = (await Promise.all([unreadableError, unreadableResult, empty])).map((answer) =>
			answer.ok ? "accepted" : answer.failure,
		);
		expect(failures).toEqual([
			{ message: "agy answered session/prompt with an error that is not a JSON-RPC error" },
			{
				message: expect.stringMatching(/^agy answered session\/new with a result the bridge cannot read \(sessionId: /),
			},
			{ message: "agy answered session/list with neither a result nor an error" },
		]);
		expect(faults).toEqual(failures.map((failure) => (typeof failure === "string" ? failure : failure.message)));
	});

	test("an oversized record and a line that is not JSON are reported as faults", () => {
		const { rpc, faults } = wire();
		rpc.receive({ kind: "oversized", bytes: 70_000_000, head: "{" });
		rpc.receive({ kind: "line", text: "not JSON" });
		expect(faults).toEqual([
			"agy sent a record of 70000000 bytes, past what the bridge reads",
			"agy sent a line that is not JSON",
		]);
	});
});
