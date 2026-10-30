/**
 * The run is the adapter's (D3): it starts when Pi accepts a prompt (`preflightResult("started")`), runs on its own
 * (an agent event with no run, trigger `system`), or compacts while idle (contract README §7: Pi's run starts at
 * the first `agent_start` or `compaction_start` while idle). It ends only on `agent_settled`, or for a compaction
 * that was the whole run, at its `compaction_end`.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, RunOutcome, RunTrigger } from "../../../contract";
import { mintRunId, ToolCallIds } from "../ids";
import { runOutcome } from "../mapping/errors";
import type { InteractionPort, RunContext, TranscriptCut } from "../ports";
import type { LiveState } from "./live-state";

export interface RunTrackerDeps {
	readonly live: LiveState;
	readonly interactions: InteractionPort;
	/** Pulls the session's totals (D10), before `run_finished`. */
	readonly refreshUsage: () => void;
}

interface ActiveRun {
	readonly context: RunContext;
	readonly cut: TranscriptCut;
	/** Pi compacts while idle: no agent loop runs, and no `agent_settled` will come. */
	readonly compactionOnly: boolean;
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
	start(trigger: RunTrigger, leafEntryId: string | null, compactionOnly = false): RunContext {
		const context: RunContext = { runId: mintRunId(), tools: new ToolCallIds() };
		this.active = { context, cut: { leafEntryId }, compactionOnly, aborting: false };
		this.deps.live.emit({ type: "run_started", runId: context.runId, trigger });
		return context;
	}

	/** The active run is an idle compaction, which a prompt cannot join. */
	get compacting(): boolean {
		return this.active?.compactionOnly === true;
	}

	cut(): TranscriptCut | undefined {
		return this.active?.cut;
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
