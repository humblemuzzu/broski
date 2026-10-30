import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { MAX_TEXT_CHARS } from "../../../contract";
import { clipStart } from "../bounds";
import type { LiveState } from "./live-state";

/** Takes the steering and follow-up input out of a streaming session's queue and hands it back to the person, steering first. */
export function returnQueuedInput(session: AgentSession, live: LiveState): void {
	if (!session.isStreaming) return;
	const { steering, followUp } = session.clearQueue();
	const texts = [...steering, ...followUp].filter((text) => text !== "");
	if (texts.length > 0)
		live.emit({ type: "input_returned", texts: texts.map((text) => clipStart(text, MAX_TEXT_CHARS)) });
}
