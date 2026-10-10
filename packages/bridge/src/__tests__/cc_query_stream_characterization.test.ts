/**
 * Characterisation of queryClaudeCode's message-stream processing against a fake SDK query.
 * Pins the emitted event stream so the pipeline split stays behaviour-preserving.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	INIT_MESSAGE,
	resetClaudeCodeState,
	runFailingQuery,
	runQuery,
	SESSION_CREATED_EVENT,
	SESSION_INIT_EVENT,
	uninstallFakeClaudeSdk,
} from "./fixtures/cc-query-harness";

beforeEach(() => {
	resetClaudeCodeState();
});
afterEach(() => {
	uninstallFakeClaudeSdk();
});

describe("queryClaudeCode stream processing", () => {
	test("init + streamed text/tool deltas + tool result + result", async () => {
		const { events, completedWith, error, captured } = await runQuery(
			[
				INIT_MESSAGE,
				{
					type: "stream_event",
					event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "Hel" } },
					parent_tool_use_id: null,
					uuid: "u1",
					session_id: "ses_cc_1",
				},
				{
					type: "stream_event",
					event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
					parent_tool_use_id: null,
					uuid: "u2",
					session_id: "ses_cc_1",
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_start",
						index: 1,
						content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} },
					},
					parent_tool_use_id: null,
					uuid: "u3",
					session_id: "ses_cc_1",
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						index: 1,
						delta: { type: "input_json_delta", partial_json: '{"file_path":"/repo/a.ts"}' },
					},
					parent_tool_use_id: null,
					uuid: "u4",
					session_id: "ses_cc_1",
				},
				{
					type: "stream_event",
					event: { type: "content_block_stop", index: 1 },
					parent_tool_use_id: null,
					uuid: "u5",
					session_id: "ses_cc_1",
				},
				{
					type: "user",
					message: {
						role: "user",
						content: [
							{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "file contents" }] },
						],
					},
					tool_use_result: { ok: true },
					parent_tool_use_id: null,
					uuid: "cp-1",
					session_id: "ses_cc_1",
				},
				{
					type: "result",
					subtype: "success",
					is_error: false,
					result: "Done",
					stop_reason: "end_turn",
					num_turns: 2,
					duration_ms: 100,
					duration_api_ms: 80,
					total_cost_usd: 0.0123,
					usage: {
						input_tokens: 100,
						output_tokens: 20,
						cache_read_input_tokens: 5,
						cache_creation_input_tokens: 3,
						iterations: [
							{ type: "message", input_tokens: 100, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 },
						],
					},
					modelUsage: {
						"claude-sonnet": {
							inputTokens: 100,
							outputTokens: 20,
							cacheReadInputTokens: 5,
							cacheCreationInputTokens: 3,
							webSearchRequests: 0,
							costUSD: 0.0123,
							contextWindow: 200000,
							maxOutputTokens: 8192,
						},
					},
					permission_denials: [],
					session_id: "ses_cc_1",
					uuid: "u9",
				},
			],
			{ cwd: "/repo" },
			"hello",
		);

		expect(captured.prompt).toBe("hello");
		expect(captured.count).toBe(1);
		expect(completedWith).toBe("ses_cc_1");
		expect(error).toBeNull();
		expect(events).toEqual([
			SESSION_CREATED_EVENT,
			SESSION_INIT_EVENT,
			{ type: "assistant-message-delta", content: "Hel" },
			{ type: "assistant-message-delta", content: "lo" },
			{ type: "tool-call", tool: "Read", input: {}, toolUseId: "toolu_1", status: "running" },
			{
				type: "tool-call",
				tool: "Read",
				input: { file_path: "/repo/a.ts" },
				toolUseId: "toolu_1",
				status: "running",
			},
			{ type: "checkpoint-created", sessionId: "ses_cc_1", checkpointUuid: "cp-1", timestamp: 0 },
			{
				type: "tool-result",
				toolUseId: "toolu_1",
				result: [{ type: "text", text: "file contents" }],
				toolUseResult: { ok: true },
			},
			{ type: "assistant-message", content: "Done" },
			{
				type: "token-usage",
				usage: {
					inputTokens: 100,
					outputTokens: 20,
					cacheReadTokens: 5,
					cacheCreationTokens: 3,
					contextWindow: 200000,
					lastIterContextTokens: 108,
				},
				totalCostUsd: 0.0123,
				modelUsage: {
					"claude-sonnet": {
						inputTokens: 100,
						outputTokens: 20,
						cacheReadInputTokens: 5,
						cacheCreationInputTokens: 3,
						webSearchRequests: 0,
						costUSD: 0.0123,
						contextWindow: 200000,
						maxOutputTokens: 8192,
					},
				},
			},
			{
				type: "result-complete",
				stopReason: "end_turn",
				numTurns: 2,
				durationMs: 100,
				durationApiMs: 80,
				subtype: "success",
				isError: false,
			},
		]);
	});

	test("without stream events the full assistant message is used, including Task subagents", async () => {
		const { events, completedWith } = await runQuery(
			[
				INIT_MESSAGE,
				{
					type: "assistant",
					message: {
						role: "assistant",
						content: [
							{ type: "text", text: "Hi" },
							{
								type: "tool_use",
								id: "toolu_2",
								name: "Task",
								input: { subagent_type: "Explore", prompt: "p", description: "d" },
							},
						],
					},
					parent_tool_use_id: null,
					uuid: "u6",
					session_id: "ses_cc_1",
				},
				{
					type: "result",
					subtype: "success",
					is_error: false,
					result: "   ",
					stop_reason: "end_turn",
					total_cost_usd: 0.001,
					session_id: "ses_cc_1",
					uuid: "u9",
				},
			],
			{ cwd: "/repo" },
		);

		expect(completedWith).toBe("ses_cc_1");
		expect(events).toEqual([
			SESSION_CREATED_EVENT,
			SESSION_INIT_EVENT,
			{ type: "assistant-message", content: "Hi" },
			{
				type: "tool-call",
				tool: "Task",
				input: { subagent_type: "Explore", prompt: "p", description: "d" },
				toolUseId: "toolu_2",
				status: "running",
			},
			{
				type: "subagent-invocation",
				subagentName: "Explore",
				toolUseId: "toolu_2",
				prompt: "p",
				description: "d",
			},
			{
				type: "result-complete",
				stopReason: "end_turn",
				numTurns: undefined,
				durationMs: undefined,
				durationApiMs: undefined,
				subtype: "success",
				isError: false,
			},
		]);
	});

	test("compact boundary, tool progress, assistant error and rate limit events", async () => {
		const { events } = await runQuery(
			[
				INIT_MESSAGE,
				{
					type: "system",
					subtype: "compact_boundary",
					compact_metadata: { trigger: "manual", pre_tokens: 1000 },
					uuid: "cb1",
					session_id: "ses_cc_1",
				},
				{
					type: "tool_progress",
					tool_use_id: "t1",
					tool_name: "Bash",
					parent_tool_use_id: null,
					elapsed_time_seconds: 3,
					task_id: "task-1",
					uuid: "tp1",
					session_id: "ses_cc_1",
				},
				{
					type: "assistant",
					error: "rate_limit",
					message: { role: "assistant", content: [] },
					parent_tool_use_id: null,
					uuid: "u7",
					session_id: "ses_cc_1",
				},
				{
					type: "rate_limit_event",
					rate_limit_info: { status: "allowed_warning", resetsAt: 123 },
					uuid: "rl1",
					session_id: "ses_cc_1",
				},
				{
					type: "result",
					subtype: "success",
					is_error: false,
					result: "",
					stop_reason: "end_turn",
					total_cost_usd: 0.001,
					session_id: "ses_cc_1",
					uuid: "u9",
				},
			],
			{ cwd: "/repo" },
		);

		expect(events).toEqual([
			SESSION_CREATED_EVENT,
			SESSION_INIT_EVENT,
			{ type: "compact-boundary", trigger: "manual", preTokens: 1000 },
			{
				type: "tool-call",
				tool: "Bash",
				input: { elapsedSeconds: 3, taskId: "task-1" },
				toolUseId: "t1",
				status: "running",
			},
			{ type: "assistant-error", errorType: "rate_limit" },
			{ type: "rate-limit-info", data: { status: "allowed_warning", resetsAt: 123 } },
			{
				type: "result-complete",
				stopReason: "end_turn",
				numTurns: undefined,
				durationMs: undefined,
				durationApiMs: undefined,
				subtype: "success",
				isError: false,
			},
		]);
	});

	test("a mid-stream error is reported through onError and skips onComplete", async () => {
		const { events, completedWith, error } = await runQuery(
			[INIT_MESSAGE],
			{ cwd: "/repo" },
			"hello",
			{},
			new Error("stream broke"),
		);

		expect(events).toEqual([SESSION_CREATED_EVENT, SESSION_INIT_EVENT]);
		expect(completedWith).toBeNull();
		expect(error?.message).toBe("stream broke");
	});

	test("an SDK spawn failure is reported through onError", async () => {
		const { error, completedWith } = await runFailingQuery(new Error("spawn failed"));

		expect(completedWith).toBeNull();
		expect(error?.message).toBe("spawn failed");
	});
});
