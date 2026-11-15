/** Pi's compaction, retry and model events as their contract events. */

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
import type { PiEventOf } from "../rpc/frames";
import { isCount } from "./usage";

const TRIGGERS: Record<PiEventOf<"compaction_start">["reason"], CompactionTrigger> = {
	manual: "manual",
	threshold: "auto",
	overflow: "overflow",
};

export function compactionStarted(
	event: PiEventOf<"compaction_start"> | Pick<PiEventOf<"compaction_start">, "reason">,
): CompactionStartedEvent {
	return { type: "compaction_started", trigger: TRIGGERS[event.reason] };
}

/** What a compaction's end says, from Pi's `compaction_end` or from the extension events that report the same. */
export interface CompactionEnd {
	readonly aborted: boolean;
	readonly errorMessage?: string | undefined;
	readonly result?: { readonly tokensBefore?: number; readonly estimatedTokensAfter?: number } | undefined;
}

export function compactionFinished(event: PiEventOf<"compaction_end"> | CompactionEnd): CompactionFinishedEvent {
	return { type: "compaction_finished", outcome: compactionOutcome(event) };
}

/**
 * `aborted` first, then `errorMessage`, else it completed: a `compaction_end` without either carries a result
 * (pi-coding-agent 1.5.2 `docs/json.md:138-157`), whose counts are kept.
 */
function compactionOutcome(event: PiEventOf<"compaction_end"> | CompactionEnd): CompactionOutcome {
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
export function compactionRunOutcome(event: PiEventOf<"compaction_end"> | CompactionEnd): RunOutcome {
	if (event.aborted) return { kind: "aborted" };
	if (event.errorMessage === undefined) return { kind: "completed" };
	return { kind: "error", error: { code: "unknown", message: phoneText(event.errorMessage) } };
}

/**
 * `retryAt` is `now + delayMs`; a delay too long to be a time leaves it out. `attempt` and `maxAttempts` are positive,
 * as Pi counts them (pi-coding-agent 1.5.2 `docs/json.md:161-170`).
 */
export function retryScheduled(event: PiEventOf<"auto_retry_start">, now: number): RetryScheduledEvent {
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
 * Pi's `finalError` is not read: it is the last message's own `errorMessage`, which the run's `error` outcome carries,
 * or the abort, which the `aborted` outcome carries.
 */
export function retryFinished(event: PiEventOf<"auto_retry_end">): RetryFinishedEvent {
	return { type: "retry_finished", succeeded: event.success };
}

/** Model and thinking are replaced together (`ModelChangedEvent`); Pi emits no event for a model change. */
export function modelChanged(modelId: ModelId | undefined, thinking: string | undefined): ModelChangedEvent {
	return {
		type: "model_changed",
		...(modelId !== undefined && { modelId }),
		...(thinking !== undefined && { thinking }),
	};
}
