/** The ask desk each host creates and wires into its `query()` options (D15). */

import type { CanUseTool, OnElicitation } from "@anthropic-ai/claude-agent-sdk";
import type { ActionResult, InteractionAnswer, PlanModeOptions, RunId } from "../../../contract";
import type { SessionEmitter } from "./live";

export interface AskHost {
	readonly live: SessionEmitter;
	/** Undefined outside a run; such an ask does not block a run. */
	activeRunId(): RunId | undefined;
	abortRun(): Promise<void>;
	planModeOptions(): PlanModeOptions | undefined;
	now(): number;
}

/** No timer answers anything (D16); an ask ends on a human, a CLI withdrawal, its run's end or the process's. */
export interface AskDesk {
	/** Never throws, never resolves `null`, idempotent per `requestId`. */
	readonly canUseTool: CanUseTool;
	readonly onElicitation: OnElicitation;
	answer(answer: InteractionAnswer): ActionResult;
	elicitationComplete(elicitationId: string): void;
	withdrawRun(runId: RunId): void;
	expireAll(): void;
}

export type AskDeskFactory = (host: AskHost) => AskDesk;
