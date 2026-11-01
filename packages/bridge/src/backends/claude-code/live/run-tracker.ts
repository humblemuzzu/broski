/**
 * D7: `run_started` on a send or an unprompted turn, `run_finished` on `session_state_changed{idle}` only. The tracker
 * keeps the run's facts (the transcript cut, the outcomes of its turns, a Stop asked for); the host orders what must
 * close before `finish` (`run-end.ts`).
 */

import type { RunId, RunOutcome, RunTrigger } from "../../../contract";
import { mintRunId } from "../ids";
import type { SessionEmitter } from "../ports/live";
import type { TranscriptCut } from "../ports/store";

export interface ActiveRun {
	readonly runId: RunId;
	readonly trigger: RunTrigger;
	/** Undefined when the chain's newest entry was not known at the start. */
	readonly cut: TranscriptCut | undefined;
	/** One per `result` frame: a run holds several turns when the CLI chains them (D7). */
	readonly outcomes: RunOutcome[];
	/** A Stop was asked for while this run was active. */
	aborting: boolean;
	/** The CLI has begun a turn for this run (`running`, a stream frame). */
	started: boolean;
}

export class RunTracker {
	private active: ActiveRun | undefined;

	/** `tail`: the newest chain entry now (null: none; undefined: not known). */
	constructor(
		private readonly live: SessionEmitter,
		private tail: string | null | undefined,
	) {}

	get current(): ActiveRun | undefined {
		return this.active;
	}

	activeRunId(): RunId | undefined {
		return this.active?.runId;
	}

	/** Every `user` and `assistant` frame of the main thread is a chain entry with its own uuid (D70). */
	noteEntry(uuid: string): void {
		this.tail = uuid;
	}

	/** A new conversation under a new session id: its chain is empty. */
	resetChain(): void {
		this.tail = null;
	}

	cut(): TranscriptCut | undefined {
		return this.active?.cut;
	}

	/** Emits `run_started`; the cut is the chain as it stands now, before the run writes anything. */
	start(trigger: RunTrigger): ActiveRun {
		const run: ActiveRun = {
			runId: mintRunId(),
			trigger,
			cut: this.tail === undefined ? undefined : { lastUuidBefore: this.tail },
			outcomes: [],
			aborting: false,
			started: false,
		};
		this.active = run;
		this.live.emit({ type: "run_started", runId: run.runId, trigger });
		return run;
	}

	noteTurn(outcome: RunOutcome): void {
		this.active?.outcomes.push(outcome);
	}

	markAborting(): void {
		if (this.active) this.active.aborting = true;
	}

	markStarted(): void {
		if (this.active) this.active.started = true;
	}

	/** Emits `run_finished` and ends the run; the outcome is `outcomeOf` unless the caller knows better. */
	finish(outcome: RunOutcome = this.outcomeOf()): RunId | undefined {
		const run = this.active;
		if (!run) return undefined;
		this.active = undefined;
		this.live.emit({ type: "run_finished", runId: run.runId, outcome });
		return run.runId;
	}

	/**
	 * A turn the person stopped makes the run `aborted`; otherwise the first turn that did not complete decides; a run
	 * whose Stop left no result is `aborted` too.
	 */
	outcomeOf(): RunOutcome {
		const run = this.active;
		if (!run) return { kind: "completed" };
		const aborted = run.outcomes.find((outcome) => outcome.kind === "aborted");
		if (aborted) return aborted;
		const failed = run.outcomes.find((outcome) => outcome.kind !== "completed");
		if (failed) return failed;
		return run.aborting && run.outcomes.length === 0 ? { kind: "aborted" } : { kind: "completed" };
	}
}
