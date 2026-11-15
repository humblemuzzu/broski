/** A message a terminal ended, as the `AssistantMessage` the run mapping reads. */

import type { AssistantMessage } from "../messages";
import type { EndedMessage } from "./protocol";

type Ended = Extract<EndedMessage, { role: "assistant" }>;

/** What the link carries of the message is all the run mapping reads: the content, the stop reason and the error text. */
export function assistantOf(message: Ended): AssistantMessage {
	return {
		role: "assistant",
		content: message.content,
		stopReason: message.stopReason,
		...(message.errorMessage !== undefined && { errorMessage: message.errorMessage }),
		timestamp: 0,
	};
}
