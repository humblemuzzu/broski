/**
 * `system/api_retry` as `retry_scheduled`; `retry_finished` from the next frame of the turn, since none says so (D22).
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../../contract";
import type { MappedEvent } from "../ports/mapping";
import { turnOutcome } from "./outcome";
import type { MapperState } from "./state";

type ApiRetry = Extract<SDKMessage, { type: "system"; subtype: "api_retry" }>;

const CAUSES: ReadonlyMap<string, string> = new Map([
	["rate_limit", "Rate limited"],
	["overloaded", "The API is overloaded"],
	["server_error", "The API had a server error"],
	["authentication_failed", "Authentication failed"],
	["invalid_request", "The API rejected the request"],
]);

function positive(value: number): number | undefined {
	return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function causeOf(frame: ApiRetry): string {
	if (frame.no_response !== undefined) {
		return `No response from the API after ${Math.round(frame.no_response.waited_ms / 1000)}s`;
	}
	const cause = CAUSES.get(frame.error) ?? frame.error.replaceAll("_", " ");
	return frame.error_status === null ? cause : `${cause} (HTTP ${frame.error_status})`;
}

/** Each attempt is announced; the CLI sends nothing when the last one worked, so the next real frame says so. */
function scheduled(state: MapperState, frame: ApiRetry): AgentEvent {
	const delay =
		Number.isFinite(frame.retry_delay_ms) && frame.retry_delay_ms >= 0 ? Math.round(frame.retry_delay_ms) : undefined;
	const maxAttempts = positive(frame.max_retries);
	state.retrying = true;
	return {
		type: "retry_scheduled",
		attempt: positive(frame.attempt) ?? 1,
		...(maxAttempts !== undefined && { maxAttempts }),
		...(delay !== undefined && { retryAt: state.now() + delay }),
		message: `${causeOf(frame)}; retrying`,
	};
}

/**
 * A frame of the main loop that settles the retry: output a request produced, or the turn's end. An assistant frame
 * with `error` is the CLI giving up ("API Error: …"), which is the retry failing.
 */
function succeeds(frame: SDKMessage): boolean | undefined {
	switch (frame.type) {
		case "stream_event":
			return frame.parent_tool_use_id === null ? true : undefined;
		case "assistant":
			if (frame.parent_tool_use_id !== null || frame.agent_id !== undefined) return undefined;
			return frame.error === undefined;
		case "result": {
			const outcome = turnOutcome(frame).kind;
			return outcome !== "aborted" && outcome !== "error";
		}
		default:
			return undefined;
	}
}

export function retryEvents(state: MapperState, frame: SDKMessage): MappedEvent[] {
	if (frame.type === "system" && frame.subtype === "api_retry") return [{ event: scheduled(state, frame) }];
	if (!state.retrying) return [];
	const succeeded = succeeds(frame);
	if (succeeded === undefined) return [];
	state.retrying = false;
	return [{ event: { type: "retry_finished", succeeded } }];
}
