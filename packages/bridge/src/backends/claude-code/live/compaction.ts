/** `compact` is a `/compact <instructions>` prompt, and `cancelCompaction` is a Stop of that run (Q13). */

import { type ActionResult, MAX_TEXT_CHARS, type SessionSnapshot } from "../../../contract";
import { clip } from "../bounds";
import { ACCEPTED, CLOSED, rejected } from "../rejections";
import type { PromptDesk } from "./prompt-desk";
import type { RunTracker } from "./run-tracker";

export function startCompaction(prompts: PromptDesk, instructions: string | undefined): Promise<ActionResult> {
	const detail = clip(instructions?.trim() ?? "", MAX_TEXT_CHARS);
	return prompts.compaction(detail === "" ? "/compact" : `/compact ${detail}`);
}

/**
 * Ends the compaction under way and nothing else. The compaction of a `compact` run is that run, so a Stop ends it;
 * one the CLI starts inside a run cannot be ended without ending the run.
 */
export async function cancelCompaction(
	snapshot: SessionSnapshot,
	runs: RunTracker,
	stop: () => Promise<ActionResult>,
	closed: boolean,
): Promise<ActionResult> {
	if (closed) return CLOSED;
	if (snapshot.compaction === undefined) return ACCEPTED;
	if (!runs.current?.compactOnly) {
		return rejected("unsupported", "Claude Code compacts inside this run: stop the run to end the compaction");
	}
	return stop();
}
