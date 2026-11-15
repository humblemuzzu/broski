/** how a run ends, errors, usage, compaction and retry events, and where each of Pi's 24 session events goes. */

import { describe, expect, test } from "bun:test";
import { errorInfo, runOutcome } from "../../backends/pi/mapping/errors";
import {
	compactionFinished,
	compactionRunOutcome,
	compactionStarted,
	modelChanged,
	retryFinished,
	retryScheduled,
} from "../../backends/pi/mapping/session-events";
import { usageOf } from "../../backends/pi/mapping/usage";
import type { PiEventOf } from "../../backends/pi/rpc/frames";
import type { SessionStats } from "../../backends/pi/rpc/replies";
import { ErrorInfo, MAX_TEXT_CHARS, RunOutcome, Usage, UsageUpdatedEvent } from "../../contract";
import { assistant, deepFreeze, piEvent, validEvents } from "./mapping_fixtures";

const failed = (errorMessage: string | undefined, extra: Record<string, unknown> = {}) =>
	assistant([], { stopReason: "error", ...(errorMessage !== undefined && { errorMessage }), ...extra });

describe("how a run ended", () => {
	test("the settle's abort flag wins, whatever the last message says", () => {
		const abortedByTool = failed("The operation was aborted.");
		expect(runOutcome(abortedByTool, true)).toEqual({ kind: "aborted" });
		expect(runOutcome(assistant([]), true)).toEqual({ kind: "aborted" });
		expect(runOutcome(undefined, true)).toEqual({ kind: "aborted" });
	});

	test.each([
		["stop", { kind: "completed" }],
		["toolUse", { kind: "completed" }],
		["pending", { kind: "completed" }],
		["length", { kind: "limit", limit: "output_tokens" }],
		["deferred", { kind: "deferred" }],
		["aborted", { kind: "aborted" }],
	] as const)("a last message that stopped with %s", (stopReason, outcome) => {
		expect(RunOutcome.parse(runOutcome(assistant([], { stopReason }), false))).toEqual(outcome);
	});

	test("an error stop is an error outcome carrying the provider's text; no message is a completed run", () => {
		expect(RunOutcome.parse(runOutcome(failed("429 Too Many Requests"), false))).toEqual({
			kind: "error",
			error: { code: "rate_limit", message: "429 Too Many Requests" },
		});
		expect(runOutcome(undefined, false)).toEqual({ kind: "completed" });
	});
});

describe("error classes", () => {
	test.each([
		["context_overflow", "prompt is too long: 250000 tokens > 200000 maximum"],
		["context_overflow", "Your input exceeds the context window of this model"],
		["quota", "You exceeded your current quota, please check your plan and billing details. (429 insufficient_quota)"],
		["quota", "Monthly usage limit reached"],
		["auth", "401 Unauthorized: invalid x-api-key"],
		["auth", "403 Forbidden"],
		["auth", "No API key found for provider faux"],
		["auth", "Authentication failed"],
		["rate_limit", "429 Too Many Requests"],
		["rate_limit", "rate_limit_error: This request would exceed the rate limit for your organization"],
		["server", "529 overloaded_error: Overloaded"],
		["server", "503 Service Unavailable"],
		["server", "The server had an error while processing your request"],
		["server", "Provider returned error"],
		["network", "fetch failed"],
		["network", "Connection error."],
		["network", "Request timed out."],
		["network", "terminated"],
		["unknown", "No more faux responses queued"],
		["unknown", "The operation was aborted."],
		["unknown", "request id req_5031 failed in 1503 ms"],
		["rate_limit", "429 rate limit exceeded for this API key"],
		["rate_limit", "Too many requests from this api-key, slow down"],
		["quota", "403 Forbidden: insufficient_quota"],
		["auth", "Your API key was rejected: 401"],
		["server", "504 Gateway Timeout"],
		["unknown", "The worker was exterminated by the OOM killer"],
		["unknown", "Tool output exceeded the forbiddenWords filter"],
		["unknown", "The billingAddress field is invalid"],
		["unknown", "Session timeouts are configured per project"],
	] as const)("%s: %s", (code, text) => {
		expect(ErrorInfo.parse(errorInfo(failed(text)))).toEqual({ code, message: text });
	});

	test("terminal escapes in a provider's text are taken out", () => {
		expect(errorInfo(failed("\u001b[31m401 Unauthorized\u001b[0m"))).toEqual({
			code: "auth",
			message: "401 Unauthorized",
		});
	});

	test("a failure with no text says so in Pi's own words", () => {
		expect(errorInfo(failed(undefined))).toEqual({ code: "unknown", message: "Unknown error" });
		expect(errorInfo(failed("   "))).toEqual({ code: "unknown", message: "Unknown error" });
	});

	test("the text is bounded", () => {
		expect(errorInfo(failed("e".repeat(MAX_TEXT_CHARS + 9))).message).toHaveLength(MAX_TEXT_CHARS);
	});

	test("the message is read, never changed", () => {
		const message = deepFreeze(failed("429"));
		expect(errorInfo(message).code).toBe("rate_limit");
	});
});

describe("cost on large input", () => {
	const MB = 1024 * 1024;

	test("classifying a megabyte of error text, of any shape, stays linear", () => {
		const shapes = ["x", "a ", "5", "50 ", "rate ", "timed ", "_", "server ", "connection ", "stream ", "\u001b["];
		const started = performance.now();
		for (const unit of shapes) {
			errorInfo(failed(unit.repeat(Math.ceil(MB / unit.length))));
		}
		expect(performance.now() - started).toBeLessThan(2000);
	});
});

describe("usage", () => {
	interface ContextUsage {
		readonly tokens: number | null;
		readonly contextWindow: number;
		readonly percent: number | null;
	}
	/** Pi's totals, with its own `total` the bridge ignores. */
	const stats = (tokens: Partial<SessionStats["tokens"]> & { total?: number }, cost = 0.5): SessionStats => ({
		tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100, ...tokens },
		cost,
	});
	/** `get_session_stats` with the context's fill Pi reports beside the totals, when it knows one. */
	const usageWith = (totals: SessionStats, fill: ContextUsage | undefined) =>
		usageOf({ ...totals, ...(fill !== undefined && { contextUsage: fill }) });
	const context = (tokens: number | null): ContextUsage => ({
		tokens,
		contextWindow: 200_000,
		percent: tokens === null ? null : tokens / 2000,
	});

	test("the totals are copied, the fill added when Pi knows it", () => {
		expect(Usage.parse(usageWith(deepFreeze(stats({})), deepFreeze(context(1234))))).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 30,
			cacheWriteTokens: 40,
			costUsd: 0.5,
			contextTokens: 1234,
			contextWindow: 200_000,
		});
	});

	test("a total is Pi's, not recomputed: its `total` and a reasoning count play no part", () => {
		const usage = usageWith(stats({ total: 7 }), undefined);
		expect(usage).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 30,
			cacheWriteTokens: 40,
			costUsd: 0.5,
		});
		expect(usage).not.toHaveProperty("reasoningTokens");
	});

	test("a fill Pi does not know is left out, never 0", () => {
		expect(usageWith(stats({}), context(null))).not.toHaveProperty("contextTokens");
		expect(usageWith(stats({}), context(null))).not.toHaveProperty("contextWindow");
		expect(usageWith(stats({}), undefined)).not.toHaveProperty("contextTokens");
		expect(usageWith(stats({}), context(0))).toMatchObject({ contextTokens: 0, contextWindow: 200_000 });
	});

	test("numbers the contract would refuse are left out instead of failing the event", () => {
		const usage = usageWith(stats({ input: -1, output: 1.5, cacheRead: Number.NaN }, Number.NaN), {
			tokens: 5,
			contextWindow: 0,
			percent: null,
		});
		expect(UsageUpdatedEvent.parse({ type: "usage_updated", usage })).toBeDefined();
		expect(usage).toEqual({ cacheWriteTokens: 40 });
	});
});

describe("compaction and retry", () => {
	test.each([
		["manual", "manual"],
		["threshold", "auto"],
		["overflow", "overflow"],
	] as const)("a %s compaction starts as %s", (reason, trigger) => {
		expect(validEvents([compactionStarted({ type: "compaction_start", reason })])[0]).toEqual({
			type: "compaction_started",
			trigger,
		});
	});

	const end = (extra: Record<string, unknown>): PiEventOf<"compaction_end"> =>
		piEvent({ type: "compaction_end", reason: "manual", aborted: false, willRetry: false, ...extra });
	const result = { summary: "s", firstKeptEntryId: "e1", tokensBefore: 9000, estimatedTokensAfter: 1200 };

	test("a compaction ends aborted, failed or completed, in that order of precedence", () => {
		const outcome = (event: PiEventOf<"compaction_end">) => {
			const finished = compactionFinished(deepFreeze(event));
			return validEvents([finished])[0] && finished.outcome;
		};
		expect(outcome(end({ aborted: true, errorMessage: "ignored", result }))).toEqual({ kind: "aborted" });
		expect(outcome(end({ errorMessage: "Compaction failed: Nothing to compact (session too small)" }))).toEqual({
			kind: "failed",
			message: "Compaction failed: Nothing to compact (session too small)",
		});
		expect(outcome(end({ result }))).toEqual({ kind: "completed", tokensBefore: 9000, tokensAfter: 1200 });
		expect(outcome(end({ result: { ...result, estimatedTokensAfter: undefined } }))).toEqual({
			kind: "completed",
			tokensBefore: 9000,
		});
		expect(outcome(end({}))).toEqual({ kind: "completed" });
		expect(outcome(end({ errorMessage: "\u001b[31mCompaction failed\u001b[0m" }))).toEqual({
			kind: "failed",
			message: "Compaction failed",
		});
	});

	test("a run that was only a compaction ends as the compaction did", () => {
		expect(compactionRunOutcome(end({ aborted: true, result }))).toEqual({ kind: "aborted" });
		expect(compactionRunOutcome(end({ result }))).toEqual({ kind: "completed" });
		expect(compactionRunOutcome(end({ errorMessage: "Compaction failed: \u001b[1mno\u001b[0m" }))).toEqual({
			kind: "error",
			error: { code: "unknown", message: "Compaction failed: no" },
		});
	});

	test("a retry is scheduled at now plus its delay, with Pi's attempt counts and the error", () => {
		const start = piEvent({
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 4000,
			errorMessage: "529 overloaded",
		});
		expect(validEvents([retryScheduled(start, 1_000_000)])[0]).toEqual({
			type: "retry_scheduled",
			attempt: 2,
			maxAttempts: 3,
			retryAt: 1_004_000,
			message: "529 overloaded",
		});
		expect(retryScheduled({ ...start, delayMs: Number.MAX_SAFE_INTEGER }, 1_000_000)).not.toHaveProperty("retryAt");
		expect(retryScheduled({ ...start, delayMs: 1.6 }, 10)).toMatchObject({ retryAt: 12 });
	});

	test("a retry finishes as it succeeded", () => {
		expect(retryFinished(piEvent({ type: "auto_retry_end", success: true, attempt: 1 }))).toEqual({
			type: "retry_finished",
			succeeded: true,
		});
		expect(retryFinished(piEvent({ type: "auto_retry_end", success: false, attempt: 3, finalError: "x" }))).toEqual({
			type: "retry_finished",
			succeeded: false,
		});
	});

	test("a model change replaces both settings, saying only what it knows", () => {
		expect(validEvents([modelChanged("faux/m1", "high")])[0]).toEqual({
			type: "model_changed",
			modelId: "faux/m1",
			thinking: "high",
		});
		expect(modelChanged(undefined, "off")).toEqual({ type: "model_changed", thinking: "off" });
		expect(modelChanged("faux/m1", undefined)).toEqual({ type: "model_changed", modelId: "faux/m1" });
	});
});
