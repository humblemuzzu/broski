import type { LiveSession } from "../../../../contract/testing/conformance-harness";
import type { ScriptedTurn } from "../../../helpers/scripted-anthropic-server";

/** Forty words, 100 ms apart: a run that can be caught mid-stream. */
export const SLOW_TEXT: ScriptedTurn = { text: Array.from({ length: 40 }, (_, i) => `word${i} `), delayMs: 100 };

/** The first `user_message` the live session showed. */
export function promptOf(live: LiveSession) {
	return live.events().find((event) => event.type === "user_message");
}
