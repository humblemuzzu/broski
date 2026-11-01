/** Lane A · the transcript items of one `SessionMessage` (D18), oldest first. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TranscriptItem } from "../../../contract";
import type { PromptRecord } from "../ports/store";

export interface ItemContext {
	/** The owner journal's record of the prompt, when this bridge sent it (D37). */
	readonly prompt: (sendUuid: string) => PromptRecord | undefined;
	readonly parentToolCallId?: string;
}

export function itemsOf(_message: SessionMessage, _context: ItemContext): TranscriptItem[] {
	return [];
}
