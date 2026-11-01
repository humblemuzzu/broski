/** D31 (the outcome of a turn) over every `terminal_reason`, and the totals `usage_updated` carries. */

import { describe, expect, test } from "bun:test";
import type { SDKResultMessage, TerminalReason } from "@anthropic-ai/claude-agent-sdk";
import { turnOutcome } from "../../../backends/claude-code/mapping/outcome";
import { usageOf } from "../../../backends/claude-code/mapping/usage";
import { type ErrorCode, RunOutcome, Usage } from "../../../contract";
import { failure, success } from "./frames";
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
		const usage = usageOf(success({ modelUsage: MODEL_USAGE, total_cost_usd: 0.51 }), "claude-opus-5-5");
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
		expect(usageOf(success({ modelUsage: MODEL_USAGE }), undefined)?.contextWindow).toBeUndefined();
		expect(usageOf(success({ modelUsage: MODEL_USAGE }), "claude-other")?.contextWindow).toBeUndefined();
	});

	test("with one model its window stands even before an init named it", () => {
		const only = { "claude-haiku-5-5": MODEL_USAGE["claude-haiku-5-5"] };
		expect(usageOf(success({ modelUsage: only }), undefined)?.contextWindow).toBe(200_000);
	});

	test("reasoning tokens are absent when no model reported them", () => {
		const only = { "claude-haiku-5-5": MODEL_USAGE["claude-haiku-5-5"] };
		expect(usageOf(success({ modelUsage: only }))).not.toHaveProperty("reasoningTokens");
	});

	test("a zeroed result (an abort before any request) says nothing", () => {
		expect(usageOf(success({ modelUsage: {}, total_cost_usd: 0 }))).toBeUndefined();
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
		const usage = usageOf({ ...base, usage: { ...base.usage, iterations } }, "claude-opus-5-5");
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
		const usage = usageOf(success({ modelUsage: bad, total_cost_usd: Number.NaN }));
		expect(Usage.safeParse(usage).success).toBe(true);
		expect(usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
		expect(usage).not.toHaveProperty("costUsd");
		expect(usage).not.toHaveProperty("contextWindow");
	});
});
