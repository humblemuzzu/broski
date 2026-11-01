/** Lane B · `status: compacting` and `compact_boundary` as `compaction_started`/`compaction_finished` (Q13). */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CompactionOutcome, CompactionTrigger } from "../../../contract";
import type { MappedEvent } from "../ports/mapping";
import type { MapperState } from "./state";

type System<S extends string> = Extract<SDKMessage, { type: "system"; subtype: S }>;

const FAILED_COMPACTION = "Compaction failed";

function started(trigger: CompactionTrigger): MappedEvent {
	return { event: { type: "compaction_started", trigger } };
}

function finished(outcome: CompactionOutcome): MappedEvent {
	return { event: { type: "compaction_finished", outcome } };
}

function tokens(value: number | undefined): number | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

/**
 * The CLI says a compaction is under way but not who asked. Its `init` opens every turn, so a compaction that starts
 * before the turn's `init` or first request is the one a person asked for; one inside a turn is the context filling.
 */
function triggerOf(state: MapperState): CompactionTrigger {
	return state.turnUnderway ? "auto" : "manual";
}

function statusEvents(state: MapperState, frame: System<"status">): MappedEvent[] {
	if (frame.status === "requesting") {
		state.turnUnderway = true;
		return [];
	}
	if (frame.status === "compacting") {
		if (state.compaction !== "none") return [];
		state.compaction = "running";
		return [started(triggerOf(state))];
	}
	if (state.compaction === "none") return [];
	if (frame.compact_result === "failed") {
		state.compaction = "none";
		return [
			finished({
				kind: "failed",
				message: frame.compact_error?.trim() || FAILED_COMPACTION,
			}),
		];
	}
	state.compaction = frame.compact_result === "success" ? "awaiting_boundary" : state.compaction;
	return [];
}

/** The boundary carries the sizes and the real trigger; it also stands alone when no `status` announced the compaction. */
function boundaryEvents(state: MapperState, frame: System<"compact_boundary">): MappedEvent[] {
	const meta = frame.compact_metadata;
	const events = state.compaction === "none" ? [started(meta.trigger)] : [];
	state.compaction = "none";
	const tokensBefore = tokens(meta.pre_tokens);
	const tokensAfter = tokens(meta.post_tokens);
	return [
		...events,
		finished({
			kind: "completed",
			...(tokensBefore !== undefined && { tokensBefore }),
			...(tokensAfter !== undefined && { tokensAfter }),
		}),
	];
}

export function compactionEvents(state: MapperState, frame: SDKMessage): MappedEvent[] {
	if (frame.type !== "system") return [];
	if (frame.subtype === "status") return statusEvents(state, frame);
	return frame.subtype === "compact_boundary" ? boundaryEvents(state, frame) : [];
}

/** A compaction still open when its turn or run ends: the boundary did not come, or the run was stopped. */
export function endCompaction(state: MapperState, kind: "completed" | "aborted"): MappedEvent[] {
	if (state.compaction === "none") return [];
	state.compaction = "none";
	return [finished({ kind })];
}
