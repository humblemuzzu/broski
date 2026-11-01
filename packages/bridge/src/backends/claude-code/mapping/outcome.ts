/** Lane B · D31: a turn's outcome by `terminal_reason` first; a refusal is an error, never `completed`. */

import type { SDKResultMessage, TerminalReason } from "@anthropic-ai/claude-agent-sdk";
import { type ErrorCode, MAX_TEXT_CHARS, type RunOutcome } from "../../../contract";
import { clip } from "../bounds";
import { phoneText } from "./phone-text";

type Failure = { readonly code: ErrorCode; readonly fallback: string };

/** The turn ended on a failure: `TerminalReason`s that are neither a clean end, an abort nor a limit. */
const FAILURES: ReadonlyMap<TerminalReason, Failure> = new Map<TerminalReason, Failure>([
	[
		"blocking_limit",
		{
			code: "context_overflow",
			fallback: "The conversation reached the context limit",
		},
	],
	[
		"rapid_refill_breaker",
		{
			code: "context_overflow",
			fallback: "The context kept refilling right after compaction",
		},
	],
	[
		"prompt_too_long",
		{
			code: "context_overflow",
			fallback: "The prompt is too long for the model",
		},
	],
	[
		"image_error",
		{
			code: "invalid_request",
			fallback: "An image in the conversation was rejected",
		},
	],
	["model_error", { code: "server", fallback: "The model failed" }],
	["api_error", { code: "server", fallback: "The API request failed" }],
	["malformed_tool_use_exhausted", { code: "tool", fallback: "The model kept sending malformed tool calls" }],
	[
		"structured_output_retry_exhausted",
		{
			code: "invalid_request",
			fallback: "The structured output never matched its schema",
		},
	],
	["tool_deferred_unavailable", { code: "tool", fallback: "A deferred tool call could not be resumed" }],
	["turn_setup_failed", { code: "unknown", fallback: "The turn could not be set up" }],
]);

/** The HTTP status of a failed API request, where the CLI reports one (`api_error_status`, `d.ts:6093`). */
function codeOfStatus(status: number | null | undefined, fallback: ErrorCode): ErrorCode {
	if (status === null) return "network";
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate_limit";
	if (status === 400) return "invalid_request";
	if (status === 404) return "model_unavailable";
	return fallback;
}

/** The text that says what went wrong: a success's `result`, an error's `errors`. */
function messageOf(result: SDKResultMessage, fallback: string): string {
	const said: unknown = result.subtype === "success" ? result.result : result.errors;
	const text = Array.isArray(said) ? said.filter((line) => typeof line === "string").join("\n") : said;
	const clean = typeof text === "string" ? phoneText(text).trim() : "";
	return clip(clean === "" ? fallback : clean, MAX_TEXT_CHARS);
}

function failure(result: SDKResultMessage, code: ErrorCode, fallback: string): RunOutcome {
	return {
		kind: "error",
		error: { code, message: messageOf(result, fallback) },
	};
}

/**
 * `terminal_reason` decides first: an interrupt is `aborted` although its subtype is `error_during_execution` and
 * `is_error` is true (Q3). A refusal is a `success` result with `is_error` and `stop_reason: "refusal"`. A `success`
 * with `is_error` and nothing more specific is an error carrying its text; the rest is `completed`.
 */
export function turnOutcome(result: SDKResultMessage): RunOutcome {
	const reason = result.terminal_reason;
	if (reason === "aborted_streaming" || reason === "aborted_tools") return { kind: "aborted" };
	if (reason === "max_turns" || result.subtype === "error_max_turns") return { kind: "limit", limit: "max_turns" };
	if (reason === "budget_exhausted" || result.subtype === "error_max_budget_usd")
		return { kind: "limit", limit: "budget" };
	if (reason === "tool_deferred") return { kind: "deferred" };
	if (result.stop_reason === "refusal") return failure(result, "content_filter", "The model refused the request");
	if (result.subtype !== "success" && result.startup_failure_reason !== undefined) {
		return failure(result, "backend_unavailable", `Claude Code could not start: ${result.startup_failure_reason}`);
	}
	const known = reason === undefined ? undefined : FAILURES.get(reason);
	if (known !== undefined) {
		const code =
			reason === "api_error" && result.subtype === "success"
				? codeOfStatus(result.api_error_status, known.code)
				: known.code;
		return failure(result, code, known.fallback);
	}
	if (result.is_error || result.subtype !== "success")
		return failure(result, "unknown", "The turn ended with an error");
	return { kind: "completed" };
}
