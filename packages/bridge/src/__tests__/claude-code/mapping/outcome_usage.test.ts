/**
 * The outcome of a turn (adapter README D8) over every `terminal_reason`, and the totals and prompt cache window
 * `usage_updated` carries.
 */

import { describe, expect, test } from "bun:test";
import type { SDKResultMessage, TerminalReason } from "@anthropic-ai/claude-agent-sdk";
import { turnOutcome } from "../../../backends/claude-code/mapping/outcome";
import { usageOf } from "../../../backends/claude-code/mapping/usage";
import { type ErrorCode, RunOutcome, Usage } from "../../../contract";
import { failure, messageStart, success } from "./frames";
import { newMapper, ofType } from "./helpers";

function outcome(result: SDKResultMessage): RunOutcome {
	const mapped = turnOutcome(result);
	expect(RunOutcome.safeParse(mapped).success).toBe(true);
	return mapped;
}

describe("turnOutcome by terminal_reason first", () => {
	test("an interrupt is aborted although its subtype is an error and is_error is true", () => {
		for (const reason of ["aborted_streaming", "aborted_tools"] as const) {
			expect(outcome(failure({ terminal_reason: reason, is_error: true }))).toEqual({ kind: "aborted" });
		}
	});

	test.each<[TerminalReason | undefined]>([
		["completed"],
		["background_requested"],
		["stop_hook_prevented"],
		["hook_stopped"],
		[undefined],
	])("a clean success (%p) completes", (reason) => {
		expect(outcome(success({ terminal_reason: reason, is_error: false }))).toEqual({ kind: "completed" });
	});

	test("the limits", () => {
		expect(outcome(failure({ subtype: "error_max_turns", terminal_reason: "max_turns" }))).toEqual({
			kind: "limit",
			limit: "max_turns",
		});
		expect(outcome(failure({ subtype: "error_max_budget_usd", terminal_reason: "budget_exhausted" }))).toEqual({
			kind: "limit",
			limit: "budget",
		});
		expect(outcome(failure({ subtype: "error_max_turns", terminal_reason: undefined }))).toEqual({
			kind: "limit",
			limit: "max_turns",
		});
	});

	test("a deferred tool call ends the run deferred", () => {
		expect(outcome(success({ terminal_reason: "tool_deferred" }))).toEqual({ kind: "deferred" });
	});

	test.each<[TerminalReason, ErrorCode]>([
		["blocking_limit", "context_overflow"],
		["rapid_refill_breaker", "context_overflow"],
		["prompt_too_long", "context_overflow"],
		["image_error", "invalid_request"],
		["model_error", "server"],
		["api_error", "server"],
		["malformed_tool_use_exhausted", "tool"],
		["structured_output_retry_exhausted", "invalid_request"],
		["tool_deferred_unavailable", "tool"],
		["turn_setup_failed", "unknown"],
	])("%s is an error with code %s", (reason, code) => {
		const mapped = outcome(failure({ terminal_reason: reason, errors: ["it broke"] }));
		expect(mapped).toEqual({ kind: "error", error: { code, message: "it broke" } });
	});

	test("a refusal is an error, never completed, whatever the terminal reason says", () => {
		for (const reason of ["completed", "api_error", undefined] as const) {
			const mapped = outcome(
				success({ is_error: true, stop_reason: "refusal", terminal_reason: reason, result: "API Error: safeguards" }),
			);
			expect(mapped).toEqual({ kind: "error", error: { code: "content_filter", message: "API Error: safeguards" } });
		}
	});

	test("an API failure reads its code from the HTTP status", () => {
		const of = (status: number | null) =>
			outcome(success({ terminal_reason: "api_error", is_error: true, result: "API Error", api_error_status: status }));
		expect(of(401)).toMatchObject({ error: { code: "auth" } });
		expect(of(403)).toMatchObject({ error: { code: "auth" } });
		expect(of(429)).toMatchObject({ error: { code: "rate_limit" } });
		expect(of(400)).toMatchObject({ error: { code: "invalid_request" } });
		expect(of(404)).toMatchObject({ error: { code: "model_unavailable" } });
		expect(of(null)).toMatchObject({ error: { code: "network" } });
		expect(of(529)).toMatchObject({ error: { code: "server" } });
	});

	test("a success with is_error and nothing more specific is an error carrying its text", () => {
		expect(outcome(success({ is_error: true, terminal_reason: undefined, result: "boom" }))).toEqual({
			kind: "error",
			error: { code: "unknown", message: "boom" },
		});
	});

	test("a result of a shape nobody expects still has an outcome, and never throws", () => {
		const odd = [{ result: 7 }, { result: null }, { errors: "text" }, { errors: [1, "two", null] }, { errors: null }];
		const wire = (base: SDKResultMessage, extra: object): SDKResultMessage =>
			JSON.parse(JSON.stringify({ ...base, ...extra }));
		for (const extra of odd) {
			expect(() => turnOutcome(wire(failure({ terminal_reason: "api_error" }), extra))).not.toThrow();
			expect(() => turnOutcome(wire(success({ is_error: true, terminal_reason: undefined }), extra))).not.toThrow();
		}
		const said = turnOutcome(wire(failure({ terminal_reason: "api_error" }), { errors: [1, "two", null] }));
		expect(said).toEqual({ kind: "error", error: { code: "server", message: "two" } });
	});

	test("an error with no text says what ended it", () => {
		const mapped = outcome(failure({ terminal_reason: "prompt_too_long", errors: [] }));
		expect(mapped).toEqual({
			kind: "error",
			error: { code: "context_overflow", message: "The prompt is too long for the model" },
		});
	});

	test("a CLI that could not start is backend_unavailable, said in words and never by its code", () => {
		const mapped = outcome(
			failure({ terminal_reason: undefined, startup_failure_reason: "bypass_root", errors: ["bypass_root"] }),
		);
		expect(mapped).toEqual({
			kind: "error",
			error: { code: "backend_unavailable", message: "Bypass permissions mode cannot run as root." },
		});
		const bare = outcome(failure({ terminal_reason: undefined, startup_failure_reason: "cli_version_too_old" }));
		expect(bare.kind === "error" && bare.error.message).toBe(
			"This Claude Code version is older than the minimum Anthropic requires. Update it.",
		);
	});

	test("a startup refusal a newer CLI added is still an outcome, never a throw", () => {
		const newer = JSON.parse(JSON.stringify(failure({ terminal_reason: undefined })));
		newer.startup_failure_reason = "some_new_reason";
		expect(outcome(newer)).toEqual({
			kind: "error",
			error: { code: "backend_unavailable", message: "Claude Code could not start (some_new_reason)." },
		});
	});

	test("a startup refusal that signing in again fixes is an auth error", () => {
		const mapped = outcome(failure({ terminal_reason: undefined, startup_failure_reason: "org_pin_mismatch" }));
		expect(mapped).toEqual({
			kind: "error",
			error: { code: "auth", message: "You are signed in to an organization your policy does not allow." },
		});
	});

	test("the message is bounded and free of terminal escapes", () => {
		const mapped = outcome(failure({ terminal_reason: undefined, errors: [`\u001B[31m${"e".repeat(2_000_000)}`] }));
		expect(mapped.kind === "error" && mapped.error.message.length).toBe(1_048_576);
		expect(mapped.kind === "error" && mapped.error.message.includes("\u001B")).toBe(false);
	});
});

const AT = 1_700_000_000_000;

const MODEL_USAGE = {
	"claude-opus-5-5": {
		inputTokens: 100,
		outputTokens: 20,
		thinkingTokens: 5,
		cacheReadInputTokens: 30,
		cacheCreationInputTokens: 10,
		webSearchRequests: 0,
		costUSD: 0.5,
		contextWindow: 1_000_000,
		maxOutputTokens: 128_000,
	},
	"claude-haiku-5-5": {
		inputTokens: 40,
		outputTokens: 8,
		cacheReadInputTokens: 0,
		cacheCreationInputTokens: 0,
		webSearchRequests: 0,
		costUSD: 0.01,
		contextWindow: 200_000,
		maxOutputTokens: 64_000,
	},
};

describe("usageOf", () => {
	test("sums the models of modelUsage, takes the cost from total_cost_usd, and the window from the session's model", () => {
		const usage = usageOf(success({ modelUsage: MODEL_USAGE, total_cost_usd: 0.51 }), "claude-opus-5-5", AT);
		expect(usage).toEqual({
			inputTokens: 140,
			outputTokens: 28,
			cacheReadTokens: 30,
			cacheWriteTokens: 10,
			reasoningTokens: 5,
			costUsd: 0.51,
			contextWindow: 1_000_000,
		});
		expect(Usage.safeParse(usage).success).toBe(true);
	});

	test("with several models and none the session's, no window is claimed", () => {
		expect(usageOf(success({ modelUsage: MODEL_USAGE }), undefined, AT)?.contextWindow).toBeUndefined();
		expect(usageOf(success({ modelUsage: MODEL_USAGE }), "claude-other", AT)?.contextWindow).toBeUndefined();
	});

	test("with one model its window stands even before an init named it", () => {
		const only = { "claude-haiku-5-5": MODEL_USAGE["claude-haiku-5-5"] };
		expect(usageOf(success({ modelUsage: only }), undefined, AT)?.contextWindow).toBe(200_000);
	});

	test("reasoning tokens are absent when no model reported them", () => {
		const only = { "claude-haiku-5-5": MODEL_USAGE["claude-haiku-5-5"] };
		expect(usageOf(success({ modelUsage: only }), undefined, AT)).not.toHaveProperty("reasoningTokens");
	});

	test("a zeroed result (an abort before any request) says nothing", () => {
		expect(usageOf(success({ modelUsage: {}, total_cost_usd: 0 }), undefined, AT)).toBeUndefined();
		const mapper = newMapper();
		expect(mapper.map(failure({ terminal_reason: "aborted_streaming", modelUsage: {} }))).toEqual([]);
	});

	test("the context in use is read from the newest model iteration, not from a compaction", () => {
		const request = (input: number, read: number, write: number) => ({
			type: "message" as const,
			input_tokens: input,
			cache_read_input_tokens: read,
			cache_creation_input_tokens: write,
			output_tokens: 1,
			model: "m",
			cache_creation: null,
		});
		const compaction = {
			type: "compaction" as const,
			input_tokens: 3,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
			output_tokens: 1,
			cache_creation: null,
		};
		const iterations = [request(10, 1, 1), request(700, 200, 50), compaction];
		const base = success({ modelUsage: MODEL_USAGE });
		const usage = usageOf({ ...base, usage: { ...base.usage, iterations } }, "claude-opus-5-5", AT);
		expect(usage?.contextTokens).toBe(950);
	});

	test("results are totals, never summed: the second result's numbers are the ones sent", () => {
		const mapper = newMapper();
		const first = mapper.map(success({ modelUsage: MODEL_USAGE, total_cost_usd: 0.5 })).map((item) => item.event);
		const second = mapper.map(success({ modelUsage: MODEL_USAGE, total_cost_usd: 0.5 })).map((item) => item.event);
		expect(ofType(first, "usage_updated")[0]?.usage).toEqual(ofType(second, "usage_updated")[0]?.usage);
	});

	test("hostile numbers become none rather than invalid values", () => {
		const bad = {
			m: {
				...MODEL_USAGE["claude-haiku-5-5"],
				inputTokens: Number.NaN,
				outputTokens: -4,
				costUSD: Number.NaN,
				contextWindow: 0,
			},
		};
		const usage = usageOf(success({ modelUsage: bad, total_cost_usd: Number.NaN }), undefined, AT);
		expect(Usage.safeParse(usage).success).toBe(true);
		expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
		expect(usage).not.toHaveProperty("costUsd");
		expect(usage).not.toHaveProperty("contextWindow");
	});
});

describe("the prompt cache window", () => {
	const written = (fiveMinutes: number, oneHour: number) => ({
		ephemeral_5m_input_tokens: fiveMinutes,
		ephemeral_1h_input_tokens: oneHour,
	});
	const request = (
		input: number,
		read: number,
		write: number,
		cacheCreation: ReturnType<typeof written> | null = null,
	) => ({
		type: "message" as const,
		input_tokens: input,
		cache_read_input_tokens: read,
		cache_creation_input_tokens: write,
		output_tokens: 1,
		model: "m",
		cache_creation: cacheCreation,
	});
	const turn = (
		iterations: SDKResultMessage["usage"]["iterations"],
		modelUsage: SDKResultMessage["modelUsage"] = MODEL_USAGE,
	): SDKResultMessage => {
		const base = success({ modelUsage });
		return { ...base, usage: { ...base.usage, iterations } };
	};
	const cacheOf = (result: SDKResultMessage) => usageOf(result, "claude-opus-5-5", AT)?.cache;

	test("a five-minute write: exact, from when the request was made, with the last request's own hit", () => {
		const cache = cacheOf(turn([request(1, 1, 1), request(100, 9_000, 900, written(900, 0))]));
		expect(cache).toEqual({
			lastTouchAt: AT,
			ttlMs: 300_000,
			confidence: "exact",
			cachedTokens: 9_000,
			promptTokens: 10_000,
		});
		expect(Usage.safeParse({ cache }).success).toBe(true);
	});

	test("a one-hour write is an hour; a write the CLI gave no lifetime is five minutes", () => {
		expect(cacheOf(turn([request(10, 0, 4_000, written(0, 4_000))]))?.ttlMs).toBe(3_600_000);
		expect(cacheOf(turn([request(10, 0, 4_000)]))?.ttlMs).toBe(300_000);
	});

	test("a request that only read keeps an hour only where the model has only written one-hour entries", () => {
		const opus = MODEL_USAGE["claude-opus-5-5"];
		const longOnly = { "claude-opus-5-5": { ...opus, cacheCreationEphemeral1hInputTokens: 4_000 } };
		const mixed = {
			"claude-opus-5-5": {
				...opus,
				cacheCreationEphemeral1hInputTokens: 4_000,
				cacheCreationEphemeral5mInputTokens: 9,
			},
		};
		expect(cacheOf(turn([request(10, 4_000, 0)], longOnly))?.ttlMs).toBe(3_600_000);
		expect(cacheOf(turn([request(10, 4_000, 0)], mixed))?.ttlMs).toBe(300_000);
		expect(cacheOf(turn([request(10, 4_000, 0)]))?.ttlMs).toBe(300_000);
	});

	test("with no iteration the turn's own usage gives the lifetime, and no hit is claimed", () => {
		const base = success({ modelUsage: MODEL_USAGE });
		const usage = { ...base.usage, cache_read_input_tokens: 50, cache_creation: written(0, 70) };
		expect(cacheOf({ ...base, usage })).toEqual({ lastTouchAt: AT, ttlMs: 3_600_000, confidence: "exact" });
	});

	test("a turn that touched no cache has no window", () => {
		expect(cacheOf(turn([request(100, 0, 0)]))).toBeUndefined();
		expect(cacheOf(success({ modelUsage: MODEL_USAGE }))).toBeUndefined();
	});

	test("the mapper stamps the window when the main loop's last response began, not when the result came", () => {
		let now = 1_000;
		const mapper = newMapper(() => now);
		mapper.map(messageStart("msg_sub"));
		now = 2_000;
		mapper.map({ ...messageStart("msg_sub_2"), parent_tool_use_id: "toolu_1" });
		now = 9_000;
		const first = mapper.map(turn([request(1, 10, 0)])).map((item) => item.event);
		expect(ofType(first, "usage_updated")[0]?.usage.cache?.lastTouchAt).toBe(1_000);
		now = 12_000;
		const second = mapper.map(turn([request(1, 10, 0)])).map((item) => item.event);
		expect(ofType(second, "usage_updated")[0]?.usage.cache?.lastTouchAt).toBe(12_000);
	});
});
