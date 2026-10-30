/** A message a terminal ended, as the `AssistantMessage` the run mapping reads. */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EndedMessage } from "./protocol";

type Ended = Extract<EndedMessage, { role: "assistant" }>;

const NO_USAGE: AssistantMessage["usage"] = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * What the link carries of the message fills in; the rest is empty, because nothing that reads it here looks at it:
 * the outcome and error class read the stop reason, error text and provider, and the stream the content.
 */
export function assistantOf(message: Ended): AssistantMessage {
	return {
		role: "assistant",
		content: message.content,
		api: "unknown",
		provider: message.provider,
		model: "unknown",
		usage: NO_USAGE,
		stopReason: message.stopReason,
		...(message.errorMessage !== undefined && { errorMessage: message.errorMessage }),
		timestamp: 0,
	};
}
