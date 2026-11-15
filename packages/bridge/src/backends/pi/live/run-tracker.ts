/**
 * The run is the adapter's: it starts when Pi answers a prompt `started`, runs on its own (an agent event with no run,
 * trigger `system`), or compacts while idle (contract README §7: Pi's run starts at the first `agent_start` or
 * `compaction_start` while idle). It ends only on `agent_settled` (`agent_end` is not the end, pi-coding-agent 1.5.2
 * `docs/rpc.md:69`), or for a compaction that was the whole run, at its `compaction_end`.
 */

import type { AgentEvent, RunOutcome, RunTrigger } from "../../../contract";
import { mintRunId, ToolCallIds } from "../ids";
import { runOutcome } from "../mapping/errors";
import type { AssistantMessage } from "../messages";
import type { InteractionPort, RunContext, TranscriptCut } from "../ports";
import type { LiveState } from "./live-state";

export interface RunTrackerDeps {
	readonly live: LiveState;
	readonly interactions: Pick<InteractionPort, "releaseRun">;
	/** Pulls the session's totals, before `run_finished`. */
	readonly refreshUsage: () => void;
}

/** A run with no agent loop: no `agent_settled` will come, and a prompt cannot join it. */
export type SoloRun = "compaction";

interface ActiveRun {
	readonly context: RunContext;
	cut: TranscriptCut;
	/** The cut is the parent of the run's first message, once that is known. */
	cutExact: boolean;
	readonly solo: SoloRun | undefined;
	aborting: boolean;
}

export class RunTracker {
	private active: ActiveRun | undefined;
	private settledWaiters: (() => void)[] = [];

	constructor(private readonly deps: RunTrackerDeps) {}

	current(): RunContext | undefined {
		return this.active?.context;
	}

	/** Emits `run_started`; `leafEntryId` is the session's leaf now, where the transcript is cut. */
	start(trigger: RunTrigger, leafEntryId: string | null, solo?: SoloRun): RunContext {
		const context: RunContext = { runId: mintRunId(), tools: new ToolCallIds() };
		this.active = { context, cut: { leafEntryId }, cutExact: false, solo, aborting: false };
		this.deps.live.emit({ type: "run_started", runId: context.runId, trigger });
		return context;
	}

	/** The active run is an idle compaction, which a prompt cannot join. */
	get compacting(): boolean {
		return this.active?.solo === "compaction";
	}

	cut(): TranscriptCut | undefined {
		return this.active?.cut;
	}

	/**
	 * The run's first message landed under `parentId`: that is where the transcript stops while the run is on. The leaf
	 * known at the run's start can be behind Pi's (an entry no event announced) or, for a run Pi began itself, ahead.
	 */
	firstMessageUnder(parentId: string | null): void {
		if (!this.active || this.active.cutExact) return;
		this.active.cut = { leafEntryId: parentId };
		this.active.cutExact = true;
	}

	/** An abort was requested for the active run, so a tool that fails now failed because of it. */
	noteAbort(): void {
		if (this.active) this.active.aborting = true;
	}

	get aborting(): boolean {
		return this.active?.aborting === true;
	}

	/** Resolves in a microtask after the active run settles, or at once when none is active. */
	afterSettle(): Promise<void> {
		if (!this.active) return Promise.resolve();
		return new Promise((resolve) => this.settledWaiters.push(resolve));
	}

	/**
	 * At `agent_settled`: closes what the run left open (`closing` events from the stream mappers),
	 * lets go of the asks still naming it, pulls the usage, then `run_finished` with the outcome.
	 */
	settle(aborted: boolean, lastAssistant: AssistantMessage | undefined, closing: readonly AgentEvent[]): void {
		this.close(runOutcome(lastAssistant, aborted), closing);
	}

	/** A run that ends without `agent_settled`: an idle compaction, or a prompt Pi did not run (`pi-prompt.ts`). */
	end(outcome: RunOutcome): void {
		this.close(outcome, []);
	}

	private close(outcome: RunOutcome, closing: readonly AgentEvent[]): void {
		const run = this.active;
		if (!run) return;
		const { live, interactions } = this.deps;
		for (const event of closing) live.emit(event);
		interactions.releaseRun(run.context.runId);
		const open = live.snapshot();
		if (open.retry) live.emit({ type: "retry_finished", succeeded: false });
		if (open.compaction) live.emit({ type: "compaction_finished", outcome: { kind: "aborted" } });
		this.deps.refreshUsage();
		this.active = undefined;
		live.emit({ type: "run_finished", runId: run.context.runId, outcome });
		this.wakeWaiters();
	}

	private wakeWaiters(): void {
		const waiters = this.settledWaiters;
		this.settledWaiters = [];
		for (const resolve of waiters) resolve();
	}
}
