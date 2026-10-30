/** Pi's compaction, retry and model events as their contract events. */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
	CompactionFinishedEvent,
	CompactionOutcome,
	CompactionStartedEvent,
	CompactionTrigger,
	ModelChangedEvent,
	ModelId,
	RetryFinishedEvent,
	RetryScheduledEvent,
	RunOutcome,
} from "../../../contract";
import { phoneText } from "../phone-text";
import type { PiEvent } from "../ports";
import { isCount } from "./usage";

const TRIGGERS: Record<PiEvent<"compaction_start">["reason"], CompactionTrigger> = {
	manual: "manual",
	threshold: "auto",
	overflow: "overflow",
};

export function compactionStarted(
	event: PiEvent<"compaction_start"> | Pick<PiEvent<"compaction_start">, "reason">,
): CompactionStartedEvent {
	return { type: "compaction_started", trigger: TRIGGERS[event.reason] };
}

/** What a compaction's end says, from Pi's `compaction_end` or from the extension events that report the same. */
export interface CompactionEnd {
	readonly aborted: boolean;
	readonly errorMessage?: string | undefined;
	readonly result?: { readonly tokensBefore?: number; readonly estimatedTokensAfter?: number } | undefined;
}

export function compactionFinished(event: PiEvent<"compaction_end"> | CompactionEnd): CompactionFinishedEvent {
	return { type: "compaction_finished", outcome: compactionOutcome(event) };
}

/**
 * `aborted` first, then `errorMessage`, else it completed: every `compaction_end` Pi emits without either carries a
 * result (pi-coding-agent `src/core/agent-session.ts:2941-2947, 3084-3091, 3265, 3282-3289`), whose counts are kept.
 */
function compactionOutcome(event: PiEvent<"compaction_end"> | CompactionEnd): CompactionOutcome {
	if (event.aborted) return { kind: "aborted" };
	if (event.errorMessage !== undefined) return { kind: "failed", message: phoneText(event.errorMessage) };
	const tokensBefore = event.result?.tokensBefore;
	const tokensAfter = event.result?.estimatedTokensAfter;
	return {
		kind: "completed",
		...(tokensBefore !== undefined && isCount(tokensBefore) && { tokensBefore }),
		...(tokensAfter !== undefined && isCount(tokensAfter) && { tokensAfter }),
	};
}

/** The outcome of a run that was only a compaction (`RunTracker`): what the compaction's own outcome says, as a run's. */
export function compactionRunOutcome(event: PiEvent<"compaction_end"> | CompactionEnd): RunOutcome {
	if (event.aborted) return { kind: "aborted" };
	if (event.errorMessage === undefined) return { kind: "completed" };
	return { kind: "error", error: { code: "unknown", message: phoneText(event.errorMessage) } };
}

/**
 * `retryAt` is `now + delayMs`; Pi's longest delay can be `Number.MAX_SAFE_INTEGER`, which is no time.
 * `attempt` and `maxAttempts` are positive: Pi emits this only for an attempt within `maxRetries`
 * (pi-coding-agent `src/core/agent-session.ts:3828-3844`).
 */
export function retryScheduled(event: PiEvent<"auto_retry_start">, now: number): RetryScheduledEvent {
	const retryAt = Math.round(now + event.delayMs);
	return {
		type: "retry_scheduled",
		attempt: event.attempt,
		maxAttempts: event.maxAttempts,
		...(isCount(retryAt) && { retryAt }),
		message: phoneText(event.errorMessage),
	};
}

/**
 * `finalError` is dropped: it is the last message's own `errorMessage`, which the run's `error` outcome
 * carries, or "Retry cancelled" for an abort, which the `aborted` outcome carries.
 */
export function retryFinished(event: PiEvent<"auto_retry_end">): RetryFinishedEvent {
	return { type: "retry_finished", succeeded: event.success };
}

/** Model and thinking are replaced together (`ModelChangedEvent`); Pi emits no event for a model change. */
export function modelChanged(modelId: ModelId | undefined, thinking: ThinkingLevel | undefined): ModelChangedEvent {
	return {
		type: "model_changed",
		...(modelId !== undefined && { modelId }),
		...(thinking !== undefined && { thinking }),
	};
}
