/**
 * How a `session/prompt` ended, as the contract's outcomes: its stop reason (ACP `StopReason`), or agy's error, in agy's
 * own words and never retried. A request the session's worker can no longer take is a lost worker, not a failed turn.
 */

import { phoneText } from "../../../adapter-kit/phone-text";
import type { CompactionOutcome, ErrorCode, RunOutcome } from "../../../contract";
import { AUTH_REQUIRED, type PromptResult } from "../acp/frames";
import { INVALID_PARAMS, type RpcFailure, type RpcResult } from "../acp/rpc";

export const WORKER_STOPPED = "the session's agy process stopped";

export interface Ended {
	readonly outcome: RunOutcome;
	/** What the person should know beside the outcome. */
	readonly notice?: string;
}

/**
 * agy 1.5.18 answers `-32602 Session not found` for a session whose worker is gone; `-32602` alone is any bad
 * parameter, so the message decides.
 */
export function isWorkerLoss(failure: RpcFailure): boolean {
	return failure.code === INVALID_PARAMS && /session not found/i.test(failure.message);
}

/** The connection itself failed (the process exited, a frame broke): no answer of agy's. */
export function isProcessLoss(failure: RpcFailure): boolean {
	return failure.code === undefined;
}

/** `aborting`: the person stopped the turn, so an error agy raised while stopping is the stop. */
export function runEnded(result: RpcResult<PromptResult>, aborting: boolean): Ended {
	if (!result.ok) {
		if (aborting) return { outcome: { kind: "aborted" } };
		return { outcome: failed(errorCodeOf(result.failure), result.failure.message) };
	}
	switch (result.result.stopReason) {
		case "end_turn":
			return { outcome: { kind: "completed" } };
		case "cancelled":
			return { outcome: { kind: "aborted" } };
		case "max_tokens":
			return { outcome: { kind: "limit", limit: "output_tokens" } };
		case "max_turn_requests":
			return { outcome: { kind: "limit", limit: "max_turns" } };
		case "refusal":
			return {
				outcome: failed("content_filter", "Antigravity's model refused to go on with this turn."),
				notice: "This prompt and everything after it are left out of what the model sees next.",
			};
		default:
			return { outcome: failed("unknown", `agy ended the turn with stop reason ${result.result.stopReason}`) };
	}
}

export function lostRun(reason: string): RunOutcome {
	return failed("backend_unavailable", `${WORKER_STOPPED}: ${reason}`);
}

export function compactionEnded(result: RpcResult<PromptResult>, aborting: boolean): CompactionOutcome {
	if (!result.ok) {
		return aborting ? { kind: "aborted" } : { kind: "failed", message: phoneText(result.failure.message) };
	}
	switch (result.result.stopReason) {
		case "end_turn":
			return { kind: "completed" };
		case "cancelled":
			return { kind: "aborted" };
		default:
			return {
				kind: "failed",
				message: phoneText(`agy ended the compaction with stop reason ${result.result.stopReason}`),
			};
	}
}

function failed(code: ErrorCode, message: string): RunOutcome {
	return { kind: "error", error: { code, message: phoneText(message) } };
}

function errorCodeOf(failure: RpcFailure): ErrorCode {
	if (failure.code === AUTH_REQUIRED) return "auth";
	return isProcessLoss(failure) ? "backend_unavailable" : "unknown";
}
