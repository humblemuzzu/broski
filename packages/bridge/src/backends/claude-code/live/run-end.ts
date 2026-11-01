/** What a run's end closes, in the order the stream rules need, before `run_finished` (D7). */

import type { CompactionOutcome, RunOutcome } from "../../../contract";
import type { AskDesk } from "../ports/asks";
import type { SessionEmitter } from "../ports/live";
import type { FrameMapper, MappedEvent } from "../ports/mapping";
import { returnQueued } from "./abort";
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
	deps.emitMapped(deps.mapper().settle(aborted ? "aborted" : "completed"));
	deps.children.endRuns(final);
	deps.desk.withdrawRun(run.runId);
	closeOpenParts(deps.live, final);
	deps.runs.finish(final);
	deps.finished();
	if (run.aborting) {
		returnQueued(deps.queue, deps.live);
		return;
	}
	handBackSteered(deps);
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

function handBackSteered(deps: RunEndDeps): void {
	const texts = deps.queue
		.takeSteered()
		.map((send) => send.typedText)
		.filter((text) => text !== "");
	if (texts.length > 0) deps.live.emit({ type: "input_returned", texts });
}
