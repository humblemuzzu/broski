/** What a run's end closes, in the order the stream rules need, before `run_finished` (D8). */

import type { CompactionOutcome, RunOutcome } from "../../../contract";
import type { AskDesk } from "../ports/asks";
import type { SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent } from "../ports/mapping";
import { returnQueued } from "./abort";
import { attempt } from "./attempt";
import type { ChildRouter } from "./child-router";
import type { PromptDesk } from "./prompt-desk";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";

export interface RunEndDeps {
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly prompts: PromptDesk;
	readonly children: ChildRouter;
	readonly desk: AskDesk;
	readonly mapper: () => FrameMapper;
	readonly emitMapped: (events: readonly MappedEvent[]) => void;
	/** The session's file changed and its row did too (running to idle). */
	readonly finished: () => void;
	/** Asks the live host for its context figure once `run_finished` is out (`context-after-run.ts`). */
	readonly measureContext: () => void;
}

/**
 * Settles what the frames left open, lets go of the asks that name the run, closes a compaction or a retry still
 * open, then `run_finished`. Then the queued input goes on, or back to the person when the run was stopped.
 * `outcome` is the run's own unless the caller knows better (the process died).
 */
export function endRun(deps: RunEndDeps, outcome?: RunOutcome): void {
	const run = deps.runs.current;
	if (!run) return;
	const final = outcome ?? deps.runs.outcomeOf();
	const aborted = final.kind === "aborted";
	const { live } = deps;
	attempt(live, "closing what the run left open", () =>
		deps.emitMapped(deps.mapper().settle(aborted ? "aborted" : "completed")),
	);
	attempt(live, "ending the subagents' runs", () => deps.children.endRuns(final));
	attempt(live, "withdrawing the run's asks", () => deps.desk.withdrawRun(run.runId));
	attempt(live, "closing a compaction", () => closeOpenParts(live, final));
	deps.runs.finish(final);
	deps.finished();
	attempt(live, "asking for the context usage", deps.measureContext);
	if (run.aborting) {
		returnQueued(deps.queue, deps.live);
		return;
	}
	deps.prompts.dispatchNext();
}

function closeOpenParts(live: SessionEmitter, outcome: RunOutcome): void {
	const open = live.snapshot();
	if (open.retry) live.emit({ type: "retry_finished", succeeded: false });
	if (open.compaction) {
		const finished: CompactionOutcome =
			outcome.kind === "aborted" ? { kind: "aborted" } : { kind: "failed", message: "the compaction did not finish" };
		live.emit({ type: "compaction_finished", outcome: finished });
	}
}
