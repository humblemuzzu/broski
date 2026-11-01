/** Lane A · the transcript items of one `SessionMessage` (D18), oldest first. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionId, TranscriptItem } from "../../../contract";
import type { PromptRecord } from "../ports/store";
import { assistantItems } from "./items-assistant";
import { userItems } from "./items-user";

export interface ItemContext {
	/** The owner journal's record of the prompt, when this bridge sent it (D37). */
	readonly prompt: (sendUuid: string) => PromptRecord | undefined;
	/** How many blocks of the entry's API message come before it (`IndexEntry.blockBase`). */
	readonly blockBase: number;
	/** The name of the tool a `tool_use` id called, when the call is in the chain. */
	readonly toolName: (toolUseId: string) => string | undefined;
	/** The subagent session a spawning tool call started. */
	readonly childOf: (toolUseId: string) => SessionId | undefined;
}

/** System entries carry only a uuid through the SDK's reader (`sdk.mjs` `$R`), so none becomes an item. */
export function itemsOf(message: SessionMessage, context: ItemContext): TranscriptItem[] {
	if (message.type === "assistant") return assistantItems(message, context);
	if (message.type === "user") return userItems(message, context);
	return [];
}
