/**
 * How a Pi run ended, as a `RunOutcome` (D3), and Pi's error strings as an
 * `ErrorInfo` (contract README §15: "error strings carry no class").
 */

import { type AssistantMessage, isContextOverflow } from "@earendil-works/pi-ai";
import type { ErrorCode, ErrorInfo, RunOutcome } from "../../../contract";
import { phoneText } from "../phone-text";

/** Pi's own wording when a failed message has no text (pi-coding-agent `src/core/agent-session.ts:3843`). */
const UNKNOWN_ERROR = "Unknown error";

/**
 * Pi gives a failure no class, only the provider's text, so the class is read from it, the first pattern that matches
 * winning: a quota error sent as an HTTP 429 is a quota, and a throttle of one API key is a throttle, not a bad key.
 * A status code or a bare word counts only on its own, as in pi-ai's own retry patterns (pi-ai `src/utils/retry.ts:43`).
 */
const CLASSES: readonly (readonly [ErrorCode, RegExp])[] = [
	[
		"quota",
		/insufficient[_ ]quota|quota[_ ]exceeded|exceeded your current quota|out of budget|budget[_ -]?(?:limit|exceeded)|\bbilling\b|usage[_ ]limit|credit balance|available balance/i,
	],
	["rate_limit", /rate[_ -]?limit|too many requests|resource[_ ]?exhausted|(?<![a-z0-9])429(?![a-z0-9])/i],
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
 * `aborted` from `agent_settled.aborted` first: an abort during a tool leaves a last assistant message
 * with `stopReason: "error"` and "The operation was aborted." (`sdk_semantics`). Else from the run's
 * last assistant message; README §7's outcome table lists `stopReason: "aborted"` as `aborted` too.
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
	return { code: errorCode(message, text), message: phoneText(text) };
}

function errorCode(message: AssistantMessage, text: string): ErrorCode {
	if (isContextOverflow(message)) return "context_overflow";
	return CLASSES.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}
