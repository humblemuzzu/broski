/**
 * How a Pi run ended, as a `RunOutcome`, and Pi's error strings as an
 * `ErrorInfo` (contract README §15: "error strings carry no class").
 */

import type { ErrorCode, ErrorInfo, RunOutcome } from "../../../contract";
import type { AssistantMessage } from "../messages";
import { phoneText } from "../phone-text";

/** Pi's own wording when a failed message has no text (pi-coding-agent 1.5.2 `dist/core/agent-session.js:3209`). */
const UNKNOWN_ERROR = "Unknown error";

/**
 * Pi gives a failure no class, only the provider's text, so the class is read from it, the first pattern that matches
 * winning: a quota error sent as an HTTP 429 is a quota, and a throttle of one API key is a throttle, not a bad key.
 * A status code or a bare word counts only on its own, as in pi-ai's own retry patterns. An overflow is read as Pi
 * reads it, from the provider error patterns of pi-ai 1.5.2 `dist/utils/overflow.js:37-82`, after the throttles and
 * Bedrock's unavailable service those patterns exclude (`:78-79`): Bedrock throttles with "Too many tokens".
 */
const CLASSES: readonly (readonly [ErrorCode, RegExp])[] = [
	[
		"quota",
		/insufficient[_ ]quota|quota[_ ]exceeded|exceeded your current quota|out of budget|budget[_ -]?(?:limit|exceeded)|\bbilling\b|usage[_ ]limit|credit balance|available balance/i,
	],
	[
		"rate_limit",
		/^Throttling error:|rate[_ -]?limit|too many requests|resource[_ ]?exhausted|(?<![a-z0-9])429(?![a-z0-9])/i,
	],
	["server", /^Service unavailable:/i],
	[
		"context_overflow",
		/prompt (?:is )?too long|prompt exceeds max length|request_too_large|input is too long for requested model|exceeds the context window|exceeds (?:the )?(?:model'?s )?maximum context length|context window exceeded|input token count.*exceeds the maximum|maximum prompt length is \d+|reduce the length of the messages|maximum context length is \d+ tokens|exceeds (?:the )?maximum allowed input length|is longer than the model'?s context length|exceeds the limit of \d+|exceeds the available context size|greater than the context length|context window exceeds limit|exceeded model token limit|too large for model with \d+ maximum context length|but the configured context size is|model_context_window_exceeded|exceeded (?:max )?context length|range of input length should be|context[_ ]length[_ ]exceeded|too many tokens|token limit exceeded|^(?:[\w -]+ API error \(413\):|413(?:\s|:|$))/i,
	],
	[
		"auth",
		/(?<![a-z0-9])(?:401|403)(?![a-z0-9])|unauthori[sz]ed|\bforbidden\b|authenticat|api[_ -]?key|permission[_ ]denied/i,
	],
	[
		"server",
		/overloaded|server[_ ]?busy|servers are currently busy|high demand|at capacity|(?<![a-z0-9])(?:500|502|503|504|520|524|529)(?![a-z0-9])|server[_ ]?(?:had an )?error|internal[_ ]?error|service[_ ]?(?:is[_ ]?)?(?:temporarily[_ ]?)?unavailable|provider[_ ]?returned[_ ]?(?:an[_ ]?)?error/i,
	],
	[
		"network",
		/network[_ ]?error|connection[_ ]?(?:error|refused|lost|reset|closed)|fetch failed|socket hang up|socket connection was closed|other side closed|getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|\btimed? ?out\b|\btimeout\b|\bterminated\b|stream (?:ended|was interrupted|disconnected)|ended without|\bwebsocket\b/i,
	],
];

/**
 * `aborted` from `agent_settled.aborted` first: an abort during a tool can leave a last assistant message that stopped
 * `error`. Else from the run's last assistant message; contract README §7's outcome table lists
 * `stopReason: "aborted"` as `aborted` too.
 */
export function runOutcome(lastAssistant: AssistantMessage | undefined, aborted: boolean): RunOutcome {
	if (aborted) return { kind: "aborted" };
	if (!lastAssistant) return { kind: "completed" };
	switch (lastAssistant.stopReason) {
		case "error":
			return { kind: "error", error: errorInfo(lastAssistant) };
		case "aborted":
			return { kind: "aborted" };
		case "length":
			return { kind: "limit", limit: "output_tokens" };
		case "deferred":
			return { kind: "deferred" };
		case "stop":
		case "toolUse":
		case "pending":
			return { kind: "completed" };
	}
}

export function errorInfo(message: AssistantMessage): ErrorInfo {
	const text = message.errorMessage?.trim() ? message.errorMessage : UNKNOWN_ERROR;
	return { code: errorCode(text), message: phoneText(text) };
}

function errorCode(text: string): ErrorCode {
	return CLASSES.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}
