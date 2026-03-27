import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapClaudeCodeStreamToRuntimeEvent } from "../runtime/claude-code-runtime-event-mapper";
import { buildClaudeCodeRuntimeState } from "../runtime/claude-code-runtime-read-models";
import { mapCodexStreamToRuntimeEvent } from "../runtime/codex-runtime-event-mapper";
import { buildCodexRuntimeState } from "../runtime/codex-runtime-read-models";
import {
	createOpenCodeMapperContext,
	mapOpenCodeSdkEventToRuntimeEvent,
} from "../runtime/opencode-runtime-event-mapper";
import { mapPiSessionsToRuntimeSessions, mapPiStateToRuntimeState } from "../runtime/pi-runtime-read-models";

function readServerSource(): string {
	const serverSrc = readFileSync(resolve(import.meta.dir, "..", "server.ts"), "utf-8");
	// Also read extracted handler files that contain server logic
	const handlerFiles = ["devices.ts", "session_view.ts", "cx_routing.ts", "misc.ts"];
	const handlerSrcs = handlerFiles.map((f: string) => {
		try {
			return readFileSync(resolve(import.meta.dir, "..", "handlers", f), "utf-8");
		} catch {
			return "";
		}
	});
	return `${serverSrc}\n${handlerSrcs.join("\n")}`;
}

describe("Runtime Abstraction", () => {
	test("Claude mapper emits common runtime events", () => {
		const started = mapClaudeCodeStreamToRuntimeEvent(
			{ type: "session-created", sessionId: "cc-1", agent: "claude-code", model: "sonnet" },
			{ backend: "claude-code", cwd: "/tmp/repo" },
		);
		expect(started?.type).toBe("agent_started");
		expect(started?.sessionId).toBe("cc-1");

		const permission = mapClaudeCodeStreamToRuntimeEvent(
			{
				type: "permission-request",
				sessionId: "cc-1",
				toolUseId: "tool-1",
				tool: "Bash",
				input: { command: "ls" },
				description: "Allow Bash?",
			},
			{ backend: "claude-code", cwd: "/tmp/repo" },
		);
		expect(permission?.type).toBe("permission_requested");

		const finished = mapClaudeCodeStreamToRuntimeEvent(
			{ type: "result-complete", stopReason: "end_turn" },
			{ backend: "claude-code", sessionId: "cc-1", cwd: "/tmp/repo" },
		);
		expect(finished?.type).toBe("agent_finished");
	});

	test("Codex mapper emits common runtime events", () => {
		const started = mapCodexStreamToRuntimeEvent(
			{ type: "notification", method: "turn/started", params: { turn: { id: "turn-1" } } },
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(started?.type).toBe("agent_started");

		const permission = mapCodexStreamToRuntimeEvent(
			{
				type: "request",
				requestId: "req-1",
				method: "item/commandExecution/requestApproval",
				params: { itemId: "item-1", command: "rm -rf build" },
			},
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(permission?.type).toBe("permission_requested");

		const tool = mapCodexStreamToRuntimeEvent(
			{
				type: "notification",
				method: "item/completed",
				params: {
					item: {
						id: "item-1",
						type: "commandExecution",
						status: "completed",
						command: "ls",
						aggregatedOutput: "file.txt",
					},
				},
			},
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(tool?.type).toBe("tool_finished");
	});

	test("OpenCode mapper emits common runtime events", () => {
		const status = mapOpenCodeSdkEventToRuntimeEvent({
			directory: "/tmp/repo",
			payload: {
				type: "session.status",
				properties: { sessionID: "oc-1", status: { type: "busy" } },
			},
		});
		expect(status?.type).toBe("session_state_changed");

		const delta = mapOpenCodeSdkEventToRuntimeEvent({
			directory: "/tmp/repo",
			payload: {
				type: "message.part.delta",
				properties: {
					sessionID: "oc-1",
					messageID: "msg-1",
					partID: "part-1",
					field: "text",
					delta: "hello",
				},
			},
		});
		expect(delta?.type).toBe("assistant_text_delta");

		const reasoning = mapOpenCodeSdkEventToRuntimeEvent({
			directory: "/tmp/repo",
			payload: {
				type: "message.part.updated",
				properties: {
					sessionID: "oc-1",
					part: {
						type: "reasoning",
						sessionID: "oc-1",
						messageID: "msg-1",
						text: "think",
					},
				},
			},
		});
		expect(reasoning?.type).toBe("assistant_thinking_delta");

		const tool = mapOpenCodeSdkEventToRuntimeEvent({
			directory: "/tmp/repo",
			payload: {
				type: "message.part.updated",
				properties: {
					sessionID: "oc-1",
					part: {
						id: "tool-1",
						type: "tool",
						tool: "Bash",
						sessionID: "oc-1",
						messageID: "msg-1",
						state: {
							status: "completed",
							input: { command: "ls" },
							output: "file.txt",
							metadata: { exitCode: 0 },
						},
					},
				},
			},
		});
		expect(tool?.type).toBe("tool_finished");
		expect(tool?.backendData).toMatchObject({ metadata: { exitCode: 0 } });
	});

	test("OpenCode mapper routes reasoning part deltas as thinking, not text", () => {
		const ctx = createOpenCodeMapperContext();

		// First, a message.part.updated announces a reasoning part with an id.
		const reasoningAnnounce = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.updated",
					properties: {
						sessionID: "oc-1",
						part: {
							id: "reasoning-part-1",
							type: "reasoning",
							sessionID: "oc-1",
							messageID: "msg-1",
							text: "Let me think",
						},
					},
				},
			},
			ctx,
		);
		expect(reasoningAnnounce?.type).toBe("assistant_thinking_delta");
		// Part ID should now be tracked as reasoning
		expect(ctx.reasoningPartIds.has("reasoning-part-1")).toBe(true);

		// A message.part.delta for the same partID with field='text' must be
		// routed as assistant_thinking_delta, NOT assistant_text_delta.
		const reasoningDelta = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.delta",
					properties: {
						sessionID: "oc-1",
						messageID: "msg-1",
						partID: "reasoning-part-1",
						field: "text",
						delta: " about this",
					},
				},
			},
			ctx,
		);
		expect(reasoningDelta?.type).toBe("assistant_thinking_delta");
		expect((reasoningDelta as any).delta).toBe(" about this");

		// A message.part.delta for a normal text part must still be text.
		const textDelta = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.delta",
					properties: {
						sessionID: "oc-1",
						messageID: "msg-1",
						partID: "text-part-1",
						field: "text",
						delta: "Hello world",
					},
				},
			},
			ctx,
		);
		expect(textDelta?.type).toBe("assistant_text_delta");
		expect((textDelta as any).delta).toBe("Hello world");
	});

	test("OpenCode mapper computes real reasoning deltas from full text", () => {
		const ctx = createOpenCodeMapperContext();

		// First update: reasoning part with 'Hello'
		const first = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.updated",
					properties: {
						sessionID: "oc-1",
						part: {
							id: "r-1",
							type: "reasoning",
							sessionID: "oc-1",
							messageID: "msg-1",
							text: "Hello",
						},
					},
				},
			},
			ctx,
		);
		expect(first?.type).toBe("assistant_thinking_delta");
		expect((first as any).delta).toBe("Hello");

		// Second update: full text is now 'Hello world' — delta should be ' world'
		const second = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.updated",
					properties: {
						sessionID: "oc-1",
						part: {
							id: "r-1",
							type: "reasoning",
							sessionID: "oc-1",
							messageID: "msg-1",
							text: "Hello world",
						},
					},
				},
			},
			ctx,
		);
		expect(second?.type).toBe("assistant_thinking_delta");
		expect((second as any).delta).toBe(" world");
	});

	test("OpenCode mapper deduplicates reasoning when deltas precede final part.updated", () => {
		const ctx = createOpenCodeMapperContext();

		// Step 1: message.part.updated announces reasoning part with empty text
		const announce = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.updated",
					properties: {
						sessionID: "oc-1",
						part: {
							id: "r-dedup",
							type: "reasoning",
							sessionID: "oc-1",
							messageID: "msg-1",
							text: "",
						},
					},
				},
			},
			ctx,
		);
		// Empty delta — returns null (no content to emit)
		expect(announce).toBeNull();

		// Step 2: message.part.delta events stream the reasoning text
		const delta1 = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.delta",
					properties: {
						sessionID: "oc-1",
						messageID: "msg-1",
						partID: "r-dedup",
						field: "text",
						delta: "Think",
					},
				},
			},
			ctx,
		);
		expect(delta1?.type).toBe("assistant_thinking_delta");
		expect((delta1 as any).delta).toBe("Think");

		const delta2 = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.delta",
					properties: {
						sessionID: "oc-1",
						messageID: "msg-1",
						partID: "r-dedup",
						field: "text",
						delta: "ing done",
					},
				},
			},
			ctx,
		);
		expect(delta2?.type).toBe("assistant_thinking_delta");
		expect((delta2 as any).delta).toBe("ing done");

		// Step 3: Final message.part.updated with full accumulated text.
		// Since deltas already tracked the text, the diff should be empty → null.
		const finalUpdate = mapOpenCodeSdkEventToRuntimeEvent(
			{
				directory: "/tmp/repo",
				payload: {
					type: "message.part.updated",
					properties: {
						sessionID: "oc-1",
						part: {
							id: "r-dedup",
							type: "reasoning",
							sessionID: "oc-1",
							messageID: "msg-1",
							text: "Thinking done",
						},
					},
				},
			},
			ctx,
		);
		// Delta = '' because lastReasoningTextByPartId already has 'Thinking done'
		// from the accumulated deltas. So the mapper returns null (no new content).
		expect(finalUpdate).toBeNull();
	});

	test("Codex mapper emits tool updates for output deltas and raw tool items", () => {
		const outputDelta = mapCodexStreamToRuntimeEvent(
			{
				type: "notification",
				method: "item/commandExecution/outputDelta",
				params: {
					itemId: "cmd-1",
					delta: "chunk",
				},
			},
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(outputDelta?.type).toBe("tool_updated");
		expect(outputDelta).toMatchObject({
			toolCallId: "cmd-1",
			toolName: "Bash",
			partialOutput: "chunk",
		});

		const rawStarted = mapCodexStreamToRuntimeEvent(
			{
				type: "notification",
				method: "rawResponseItem/completed",
				params: {
					item: {
						id: "tool-2",
						type: "function_call",
						name: "grep",
						arguments: '{"pattern":"TODO"}',
					},
				},
			},
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(rawStarted?.type).toBe("tool_started");
		expect(rawStarted).toMatchObject({ toolCallId: "tool-2", toolName: "grep" });

		const rawFinished = mapCodexStreamToRuntimeEvent(
			{
				type: "notification",
				method: "rawResponseItem/completed",
				params: {
					item: {
						id: "tool-2",
						type: "function_call_output",
						output: "done",
					},
				},
			},
			{ backend: "codex", threadId: "cx-1", cwd: "/tmp/repo" },
		);
		expect(rawFinished?.type).toBe("tool_finished");
		expect(rawFinished).toMatchObject({ toolCallId: "tool-2", output: "done" });
	});

	test("runtime state builders mark Claude and Codex streaming state honestly", () => {
		const ccState = buildClaudeCodeRuntimeState({
			sessionId: "cc-1",
			cwd: "/tmp/repo",
			isStreaming: true,
			model: "sonnet",
		});
		expect(ccState.backend).toBe("claude-code");
		expect(ccState.isStreaming).toBeTrue();

		const cxState = buildCodexRuntimeState({
			threadId: "cx-1",
			cwd: "/tmp/repo",
			isStreaming: false,
		});
		expect(cxState.backend).toBe("codex");
		expect(cxState.isStreaming).toBeFalse();
	});

	test("Pi runtime read models preserve active sessions honestly", () => {
		const piState = mapPiStateToRuntimeState({
			model: null,
			thinkingLevel: "high",
			isStreaming: true,
			isCompacting: false,
			isRetrying: false,
			sessionFile: "/tmp/repo/.pi/session.jsonl",
			sessionId: "pi-1",
			sessionName: "Pi session",
			steeringMode: "all",
			followUpMode: "all",
			autoCompactionEnabled: true,
			autoRetryEnabled: true,
			messageCount: 2,
			pendingMessageCount: 0,
			isBashRunning: false,
			hasPendingBashMessages: false,
			retryAttempt: 0,
		});
		expect(piState.backend).toBe("pi");
		expect(piState.isStreaming).toBeTrue();

		const sessions = mapPiSessionsToRuntimeSessions(
			[
				{
					id: "pi-1",
					path: "/tmp/repo/.pi/session.jsonl",
					cwd: "/tmp/repo",
					created: 1,
					modified: 2,
					messageCount: 2,
					firstMessage: "hello",
				},
				{
					id: "pi-2",
					path: "/tmp/other/.pi/session.jsonl",
					cwd: "/tmp/other",
					created: 3,
					modified: 4,
					messageCount: 1,
					firstMessage: "hi",
				},
			],
			[
				{
					cwd: "/tmp/repo",
					state: {
						model: null,
						thinkingLevel: "high",
						isStreaming: true,
						isCompacting: false,
						isRetrying: false,
						sessionFile: "/tmp/repo/.pi/session.jsonl",
						sessionId: "pi-1",
						sessionName: "Pi session",
						steeringMode: "all",
						followUpMode: "all",
						autoCompactionEnabled: true,
						autoRetryEnabled: true,
						messageCount: 2,
						pendingMessageCount: 0,
						isBashRunning: false,
						hasPendingBashMessages: false,
						retryAttempt: 0,
					},
				},
			],
		);

		expect(sessions[0]?.isActive).toBeTrue();
		expect(sessions[1]?.isActive).toBeUndefined();
	});

	test("server emits runtime_state snapshots for reconnect paths", () => {
		const src = readServerSource();
		// biome may format to double quotes — check either style
		const has = (needle: string) => src.includes(needle) || src.includes(needle.replace(/'/g, '"'));
		expect(has("backend: 'claude-code'")).toBe(true);
		expect(src).toContain("buildClaudeCodeRuntimeState(");
		expect(has("backend: 'codex'")).toBe(true);
		expect(src).toContain("buildCodexRuntimeState(");
		expect(has("backend: 'opencode'")).toBe(true);
		expect(src).toContain("mapOpenCodeStatusToRuntimeState(");
		expect(src).toContain("buildPiActiveRuntimeStateMessages()");
		expect(src).toContain("findPiActiveRuntimeStateMessage(nextSessionId)");
		expect(has("type: 'runtime_state'")).toBe(true);
	});
});
