/**
 * Behaviour of the extracted Claude Code chat handler, exercised through its exported entry point
 * with a fake connector. Replaces the source-text assertions that used to read server.ts and
 * handlers/cc_chat.ts as strings.
 */

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { type CcChatHandlerContext, handleCcChat } from "../handlers/cc_chat";
import type { ServerMessage } from "../types";

type Emitted = { sessionId: string; message: Record<string, unknown>; ownerArgCount: number };

function fakeSocket(): ServerWebSocket<unknown> {
	return {
		send: () => 1,
		close: () => {},
		status: 1,
	} as unknown as ServerWebSocket<unknown>;
}

function harness(options: {
	timeoutMs?: number;
	available?: boolean;
	run?: (ctx: {
		onMessage: (message: unknown) => void;
		onComplete: (sessionId: string) => void;
		onError: (error: Error) => void;
		onPermission: (request: unknown) => Promise<unknown>;
	}) => Promise<void>;
}) {
	const emitted: Emitted[] = [];
	const sent: ServerMessage[] = [];
	const sdkEvents: unknown[] = [];
	const maps = {
		owners: new Map<string, ServerWebSocket<unknown>>(),
		cwds: new Map<string, string>(),
		permissionWaiters: new Map<string, { resolve: (response: unknown) => void; timer: Timer }>(),
		elicitationWaiters: new Map<string, { resolve: (response: unknown) => void; timer: Timer }>(),
		eventBuffers: new Map<string, Array<{ event: unknown; ts: number }>>(),
	};
	const ws = fakeSocket();
	let pending: Promise<void> | undefined;

	const ctx: CcChatHandlerContext = {
		claudeCode: {
			getConfig: async () => ({
				model: "sonnet",
				permissionMode: "default",
				allowedTools: [],
				disallowedTools: [],
				maxTurns: 2,
			}),
			checkClaudeCodeAvailable: async () => options.available ?? true,
			preparePromptWithAttachments: async (prompt: string) => prompt,
			queryClaudeCode: async (
				_prompt: string,
				_options: any,
				onMessage: (message: unknown) => void,
				onComplete: (sessionId: string) => void,
				onError: (error: Error) => void,
				onPermission: (request: unknown) => Promise<unknown>,
			) => {
				pending = options.run?.({ onMessage, onComplete, onError, onPermission });
				await pending;
			},
		},
		safeString: (value: unknown) => (typeof value === "string" ? value : ""),
		log: () => {},
		ws,
		send: (_ws, message) => {
			sent.push(message);
		},
		ccSessionOwners: maps.owners,
		ccSessionCwds: maps.cwds,
		ccPermissionWaiters: maps.permissionWaiters as never,
		ccElicitationWaiters: maps.elicitationWaiters as never,
		ccEventBuffers: maps.eventBuffers as never,
		PERMISSION_TIMEOUT_MS: options.timeoutMs ?? 80,
		buildClaudeCodeRuntimeState: (params) => ({
			backend: "claude-code",
			sessionId: params.sessionId,
			cwd: params.cwd,
			isStreaming: params.isStreaming,
		}),
		broadcastToSessionWatchers: () => {},
		emitCcStream: (sessionId: string, message: unknown, ...owner: unknown[]) => {
			emitted.push({ sessionId, message: message as Record<string, unknown>, ownerArgCount: owner.length });
		},
		enqueueSdkEvent: (event) => {
			sdkEvents.push(event);
		},
		syncExternalTailForKey: () => {},
		makeSessionKey: () => null,
	};

	return { ctx, maps, ws, emitted, sent, sdkEvents, done: () => pending ?? Promise.resolve() };
}

async function runCcChat(h: ReturnType<typeof harness>, message: Record<string, unknown> = {}): Promise<void> {
	await handleCcChat({ type: "cc_chat", cwd: "/tmp/repo", prompt: "hello", ...message } as never, () => {}, h.ctx);
	// The handler fires the connector without awaiting it, so wait for the fake turn to finish.
	await h.done();
}

describe("cc_chat permission timeout", () => {
	test("the injected timeout is honoured and the waiter rejects", async () => {
		let result: unknown;
		let elapsed = 0;
		const h = harness({
			timeoutMs: 80,
			run: async ({ onPermission, onComplete }) => {
				const startedAt = Date.now();
				result = await onPermission({
					sessionId: "cc-perm",
					toolUseId: "tool-1",
					tool: "Bash",
					input: { command: "rm" },
				});
				elapsed = Date.now() - startedAt;
				onComplete("cc-perm");
			},
		});

		await runCcChat(h, { sessionId: "cc-perm" });

		const permissionRequest = h.emitted.find((entry) => entry.message.type === "permission-request");
		expect(permissionRequest).toBeDefined();
		expect(permissionRequest?.message.toolUseId).toBe("tool-1");
		expect(permissionRequest?.sessionId).toBe("cc-perm");
		expect(result).toEqual({ response: "reject" });
		// 80 ms, not a hardcoded 120_000/600_000. The bound only rules out the default; a loaded
		// machine can add scheduling delay without the waiter having used the wrong timeout.
		expect(elapsed).toBeGreaterThanOrEqual(70);
		expect(elapsed).toBeLessThan(5_000);
		expect(h.maps.permissionWaiters.size).toBe(0);
	});

	test("a duplicate permission request for the same tool call is denied without a second waiter", async () => {
		const h = harness({
			timeoutMs: 60,
			run: async ({ onPermission, onComplete }) => {
				const request = { sessionId: "cc-dup", toolUseId: "tool-9", tool: "Bash", input: {} };
				const first = onPermission(request);
				const second = await onPermission(request);
				expect(second).toEqual({ response: "reject" });
				await first;
				onComplete("cc-dup");
			},
		});

		await runCcChat(h, { sessionId: "cc-dup" });
		expect(h.emitted.filter((entry) => entry.message.type === "permission-request")).toHaveLength(2);
	});
});

describe("cc_chat session lifecycle", () => {
	test("completion clears ownership and the event buffer and broadcasts idle", async () => {
		const h = harness({
			run: async ({ onComplete }) => {
				onComplete("cc-done");
			},
		});
		h.maps.owners.set("cc-done", h.ws);
		h.maps.cwds.set("cc-done", "/tmp/repo");
		h.maps.eventBuffers.set("cc-done", [{ event: {}, ts: 1 }]);

		await runCcChat(h, { sessionId: "cc-done" });

		expect(h.maps.owners.has("cc-done")).toBe(false);
		expect(h.maps.cwds.has("cc-done")).toBe(false);
		expect(h.maps.eventBuffers.has("cc-done")).toBe(false);
		const idle = h.sdkEvents.find(
			(event) => (event as { payload?: { type?: string } })?.payload?.type === "session.idle",
		);
		expect(idle).toBeDefined();
	});

	test("an error clears ownership and the event buffer and reports cc_error", async () => {
		const h = harness({
			run: async ({ onError }) => {
				onError(new Error("boom"));
			},
		});
		h.maps.owners.set("cc-err", h.ws);
		h.maps.eventBuffers.set("cc-err", [{ event: {}, ts: 1 }]);

		await runCcChat(h, { sessionId: "cc-err" });

		const error = h.emitted.find((entry) => entry.message.type === "error");
		expect(error?.message.message).toBe("boom");
		expect(error?.message.code).toBe("cc_error");
		expect(h.maps.owners.has("cc-err")).toBe(false);
		expect(h.maps.eventBuffers.has("cc-err")).toBe(false);
	});

	test("a stream message is tagged with a per-turn messageId and routed through emitCcStream", async () => {
		const h = harness({
			run: async ({ onMessage, onComplete }) => {
				onMessage({ type: "assistant-message-delta", sessionId: "cc-stream", text: "hi" });
				onMessage({ type: "token-usage", sessionId: "cc-stream", usage: { input: 1 } });
				onComplete("cc-stream");
			},
		});

		await runCcChat(h, { sessionId: "cc-stream" });

		const deltas = h.emitted.filter((entry) => entry.message.type === "assistant-message-delta");
		expect(deltas).toHaveLength(1);
		expect(typeof deltas[0]?.message.messageId).toBe("string");
		expect(deltas[0]?.message.messageId).toMatch(/^cc-msg-/);
	});

	test("resuming a session marks it busy on the owner socket", async () => {
		const h = harness({
			run: async ({ onComplete }) => {
				onComplete("cc-busy");
			},
		});

		await runCcChat(h, { sessionId: "cc-busy" });

		const busy = h.sent.find(
			(message) => message.type === "runtime_state" && (message.data as { isStreaming?: boolean }).isStreaming === true,
		);
		expect(busy).toBeDefined();
	});

	test("an unavailable Claude Code reports cc_auth_missing", async () => {
		const h = harness({ available: false, run: async () => {} });

		await runCcChat(h);

		const error = h.emitted.find((entry) => entry.message.type === "error");
		expect(error?.message.code).toBe("cc_auth_missing");
	});

	test("a missing cwd is rejected", async () => {
		const h = harness({ run: async () => {} });
		const replies: unknown[] = [];
		await handleCcChat({ type: "cc_chat", prompt: "hi" } as never, (message) => replies.push(message), h.ctx);
		expect(replies[0]).toEqual({ type: "error", message: "Missing cwd" });
	});
});
