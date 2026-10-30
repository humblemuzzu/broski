import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ActionResult } from "../../../contract";
import { errorText } from "../error-text";
import { ACCEPTED, rejected } from "../rejections";

export interface CompactionFacts {
	/** The adapter has a run under way. */
	readonly running: boolean;
	/** Resolves when the next `compaction_start` reaches the adapter. */
	readonly started: () => Promise<void>;
}

/**
 * `control.compact` (contract README §6: refused while running, since Pi's `compact()` aborts the run, pi
 * `src/core/agent-session.ts:2828-2831`). Answered once Pi has taken it: when `compaction_start` arrives, so the
 * session lock the caller holds keeps a prompt from slipping in between; a failure after that is the
 * `compaction_finished{failed}` Pi emits.
 */
export async function requestCompaction(
	session: AgentSession,
	instructions: string | undefined,
	facts: CompactionFacts,
): Promise<ActionResult> {
	if (facts.running || session.isStreaming || session.isCompacting) {
		return rejected("busy", "compaction needs a session with no run under way");
	}
	if (!session.model) return rejected("no_model", "the session has no model to compact with");
	const started = facts.started();
	let failure: unknown;
	let failed = false;
	const finished = session.compact(instructions).then(
		() => undefined,
		(error: unknown) => {
			failed = true;
			failure = error;
		},
	);
	const begun = await Promise.race([started.then(() => true), finished.then(() => false)]);
	return failed && !begun ? rejected("backend_error", errorText(failure)) : ACCEPTED;
}
