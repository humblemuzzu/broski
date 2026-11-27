/** Stop (D9): `interruptQuery(query, {cancelQueued: true})`; queued input comes back as `input_returned`. */

import type { Query } from "@anthropic-ai/claude-agent-sdk";
import { ACCEPTED, CLOSED } from "../../../adapter-kit/rejections";
import { type ActionResult, MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { SessionEmitter } from "../ports/live";
import { interruptQuery } from "../sdk/interrupt";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";
import { INTERRUPT_DEADLINE_MS, within } from "./shutdown";

export interface AbortDeps {
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly live: SessionEmitter;
	readonly query: () => Query | undefined;
	/** Ends the process: the run then ends `aborted` with it. */
	readonly kill: () => void;
	readonly closed: () => boolean;
}

/** What the queue held and the person has not seen delivered goes back to their composer, steering first. */
export function returnQueued(queue: InputQueue, live: SessionEmitter): void {
	const texts = queue
		.takeAll()
		.map((send) => clip(send.text, MAX_TEXT_CHARS))
		.filter((text) => text !== "")
		.slice(0, MAX_LIST_ITEMS);
	if (texts.length > 0) live.emit({ type: "input_returned", texts });
}

/**
 * Ends the active run; accepted and without effect when there is none, except that input left queued with no run to
 * deliver it goes back to the person. Does not wait for the run to end.
 */
export async function abortRun(deps: AbortDeps): Promise<ActionResult> {
	if (deps.closed()) return CLOSED;
	if (!deps.runs.current) {
		returnQueued(deps.queue, deps.live);
		return ACCEPTED;
	}
	deps.runs.markAborting();
	const query = deps.query();
	if (query) await interruptOrKill(deps, query);
	returnQueued(deps.queue, deps.live);
	return ACCEPTED;
}

/**
 * The CLI answers an interrupt with a receipt before the interrupted turn's result, so what it cancelled is known
 * when this resolves; one macrotask lets the frames that were already read reach the host first.
 */
async function interruptOrKill(deps: AbortDeps, query: Query): Promise<void> {
	const outcome = await within(
		Promise.resolve()
			.then(() => interruptQuery(query, { cancelQueued: true }))
			.then(
				() => "answered" as const,
				() => "failed" as const,
			),
		INTERRUPT_DEADLINE_MS,
		"silent" as const,
	);
	if (outcome !== "answered") deps.kill();
	await new Promise<void>((resolve) => setImmediate(resolve));
}
