import type { ActionResult } from "../../../contract";
import { ACCEPTED, rejected } from "../rejections";
import type { InteractionDesk } from "../ui/interactions";
import type { LiveState } from "./live-state";
import type { PiChild } from "./pi-child";
import type { PromptDesk } from "./prompt-desk";
import { returnQueuedInput } from "./queue-return";
import type { RunTracker } from "./run-tracker";

export interface AbortParts {
	readonly runs: RunTracker;
	readonly interactions: InteractionDesk;
	readonly prompts: PromptDesk;
	readonly child: PiChild;
	readonly live: LiveState;
}

/**
 * Stops what runs, as Esc does in the terminal: the run's asks are withdrawn (Pi gets its default for each), the
 * input queued behind the run goes back to the person, and Pi aborts (pi-coding-agent 1.5.2 `docs/rpc-commands.md:94-128`).
 * Pi answers `abort` once the run has stopped, which a tool that ignores its signal can put off: past the deadline
 * the abort is still accepted, and the run ends when Pi settles it.
 */
export async function abortRun({ runs, interactions, prompts, child, live }: AbortParts): Promise<ActionResult> {
	const run = runs.current();
	if (run) {
		runs.noteAbort();
		interactions.withdrawRun(run.runId);
	} else {
		prompts.noteAbort();
	}
	await returnQueuedInput(child, live);
	const answer = await child.abort();
	if (answer.ok || child.running) return ACCEPTED;
	return rejected("backend_error", `the abort failed: ${answer.error}`);
}
