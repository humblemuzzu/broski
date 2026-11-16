/**
 * The CLI process ended while the host lives: what it leaves open closes, its background tasks are gone with it, and
 * what it was owed goes back to the person.
 */

import { MAX_TEXT_CHARS, type RunOutcome } from "../../../contract";
import { clip } from "../bounds";
import type { AskDesk } from "../ports/asks";
import type { SessionEmitter } from "../ports/live";
import { returnQueued } from "./abort";
import { attempt } from "./attempt";
import { errorText } from "./error-text";
import type { InputQueue } from "./queue";
import type { RunTracker } from "./run-tracker";

export interface ProcessEndDeps {
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly desk: AskDesk;
	readonly endRun: (outcome: RunOutcome) => void;
}

/** `stopped`: the host closed it (a Stop that was not answered); `error`: how the stream ended. */
export function processEnded(deps: ProcessEndDeps, stopped: boolean, error: unknown): void {
	attempt(deps.live, "expiring the asks", () => deps.desk.expireAll());
	const message = error === undefined ? "Claude Code stopped" : `Claude Code stopped: ${errorText(error)}`;
	if (!stopped) deps.live.emit({ type: "notice", level: "error", text: clip(message, MAX_TEXT_CHARS) });
	const run = deps.runs.current;
	if (run) {
		deps.endRun(
			run.aborting || stopped
				? { kind: "aborted" }
				: { kind: "error", error: { code: "backend_unavailable", message: clip(message, MAX_TEXT_CHARS) } },
		);
	}
	if (deps.live.snapshot().backgroundTasks.length > 0) deps.live.emit({ type: "background_tasks_changed", tasks: [] });
	returnQueued(deps.queue, deps.live);
}
