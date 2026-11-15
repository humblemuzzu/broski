import type { ActionResult } from "../../../contract";
import { ACCEPTED, rejected } from "../rejections";
import type { PiChild } from "./pi-child";

export interface CompactionFacts {
	/** The adapter has a run under way. */
	readonly running: boolean;
	readonly hasModel: boolean;
	/** Resolves when the next `compaction_start` reaches the adapter. */
	readonly started: () => Promise<void>;
}

/**
 * `control.compact` (contract README §6: refused while running, since Pi's compaction aborts the run). Answered once
 * Pi has taken it, when `compaction_start` arrives, so the session lock the caller holds keeps a prompt from slipping
 * in between; Pi answers the command itself only when the compaction has ended (`docs/rpc-commands.md:365-404`), and a
 * failure after its start is the `compaction_finished{failed}` Pi emits.
 */
export async function requestCompaction(
	child: PiChild,
	instructions: string | undefined,
	facts: CompactionFacts,
): Promise<ActionResult> {
	if (facts.running) return rejected("busy", "compaction needs a session with no run under way");
	if (!facts.hasModel) return rejected("no_model", "the session has no model to compact with");
	const started = facts.started().then(() => ACCEPTED);
	const finished = child
		.compact(instructions)
		.then((answer) => (answer.ok ? ACCEPTED : rejected("backend_error", answer.error)));
	return Promise.race([started, finished]);
}
