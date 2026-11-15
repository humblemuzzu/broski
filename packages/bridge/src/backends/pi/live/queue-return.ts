import { MAX_TEXT_CHARS } from "../../../contract";
import { clipStart } from "../bounds";
import type { LiveState } from "./live-state";
import type { PiChild } from "./pi-child";

/**
 * Takes the steering and follow-up input out of Pi's queue and hands it back to the person, steering first, as the
 * terminal's Esc does: `clear_queue` before `abort` (pi-coding-agent 1.5.2 `docs/rpc-commands.md:107-128`).
 */
export async function returnQueuedInput(child: PiChild, live: LiveState): Promise<void> {
	const answer = await child.clearQueue();
	if (!answer.ok) return;
	const texts = [...answer.data.steering, ...answer.data.followUp].filter((text) => text !== "");
	if (texts.length > 0) {
		live.emit({ type: "input_returned", texts: texts.map((text) => clipStart(text, MAX_TEXT_CHARS)) });
	}
}
