import type { PromptInput, PromptResult, SessionControl } from "../contract";
import type { PromptSend } from "./bridge-queue";
import type { LiveSession } from "./live-session";
import type { CoreClock } from "./ports";
import { rejected } from "./results";

/** How long a steer waits for the run it stops to end before it gives up. */
export const STEER_STOP_MS = 10_000;

/**
 * Steering for a backend that cannot join a running run: the run is stopped and the steer starts the next one. What
 * the bridge queued stays queued, behind it. A run that has not ended `STEER_STOP_MS` after the abort leaves the steer
 * unsent (`busy`).
 */
export class SteerFallback {
	constructor(
		private readonly send: PromptSend,
		private readonly clock: CoreClock,
	) {}

	async steer(live: LiveSession, control: SessionControl, input: PromptInput): Promise<PromptResult> {
		const start: PromptInput = { ...input, mode: "start" };
		if (!live.snapshot.run) return this.send(live, control, start);
		live.extras.restarting = true;
		try {
			const stopped = await control.abort();
			if (stopped.status === "rejected") return stopped;
			if (!(await this.runEnded(live))) {
				return rejected("busy", `the run did not stop within ${STEER_STOP_MS} ms to take the steer`);
			}
			return await this.send(live, control, start);
		} finally {
			live.extras.restarting = false;
		}
	}

	/** Whether the session's run has ended, waiting for it up to `STEER_STOP_MS`. */
	private runEnded(live: LiveSession): Promise<boolean> {
		if (!live.snapshot.run) return Promise.resolve(true);
		const { runEnds } = live.extras;
		return new Promise((resolve) => {
			const ended = () => {
				runEnds.delete(ended);
				cancel();
				resolve(true);
			};
			const cancel = this.clock.after(STEER_STOP_MS, () => {
				runEnds.delete(ended);
				resolve(false);
			});
			runEnds.add(ended);
		});
	}
}
