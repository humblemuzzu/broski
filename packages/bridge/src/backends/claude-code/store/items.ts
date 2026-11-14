/** Lane A · the transcript items of one `SessionMessage` (D18), oldest first. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionId, TranscriptItem } from "../../../contract";
import type { PromptRecord } from "../ports/store";
import { assistantItems } from "./items-assistant";
import { systemItems } from "./items-system";
import { userItems } from "./items-user";
import type { SystemFact } from "./system-facts";

export interface ItemContext {
	/** The owner journal's record of the prompt, when this bridge sent it (D37). */
	readonly prompt: (sendUuid: string) => PromptRecord | undefined;
	/** How many blocks of the entry's API message come before it (`IndexEntry.blockBase`). */
	readonly blockBase: number;
	/** The name of the tool a `tool_use` id called, when the call is in the chain. */
	readonly toolName: (toolUseId: string) => string | undefined;
	/** The subagent session a spawning tool call started. */
	readonly childOf: (toolUseId: string) => SessionId | undefined;
	/** The entry's `toolUseResult` from the raw file, bounded (D41a); undefined when it has none or could not be read. */
	readonly toolUseResult?: unknown;
	/** What the raw file says of this entry when it is a `system` entry, and of the chain entry before it. */
	readonly system?: SystemFact;
	readonly previousSystem?: SystemFact;
}

export function itemsOf(message: SessionMessage, context: ItemContext): TranscriptItem[] {
	return ownItems(message, context);
}

function ownItems(message: SessionMessage, context: ItemContext): TranscriptItem[] {
	if (message.type === "assistant") return assistantItems(message, context);
	if (message.type === "user") return userItems(message, context);
	return systemItems(message, context.system);
}
