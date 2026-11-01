/** Lane D · D7: `run_started` on a send or an unprompted turn, `run_finished` on `session_state_changed{idle}` only. */

import type { RunId, RunOutcome, RunTrigger } from "../../../contract";

export class RunTracker {
	active(): RunId | undefined {
		return undefined;
	}

	start(_trigger: RunTrigger): RunId | undefined {
		return undefined;
	}

	noteOutcome(_outcome: RunOutcome): void {}

	finish(): void {}
}
