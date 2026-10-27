/**
 * One Pi session entry as the messages a transcript shows for it.
 *
 * A transcript is the whole leaf-to-root path, not the agent's context: a compaction contributes a
 * summary marker at the point it happened, and the entries it summarised stay above it, so a user
 * can scroll back past every compaction to the first prompt.
 *
 * A `context_edit` never shows up as a message of its own: it replaces (or omits) the content of an
 * earlier entry, which is why the caller collects them for the whole path before mapping any
 * window of it.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextEditEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import { mapAgentMessages } from "./pi-events";
import type { PiSessionTranscript } from "./pi-session-transcript";

export type ContextEditReplacement = ContextEditEntry["replacement"];

/** The roles a `context_edit` may rewrite, as the SDK's own projection allows. */
const EDITABLE_ROLES = new Set(["user", "assistant", "toolResult", "custom"]);

function replaceContent(message: AgentMessage, content: unknown): AgentMessage {
	const role: string = message.role;
	if (!EDITABLE_ROLES.has(role)) return message;
	const replacement =
		(role === "assistant" || role === "toolResult") && typeof content === "string"
			? [{ type: "text", text: content }]
			: content;
	// A message keeps its metadata and only gains new content, which no single union member can
	// express: the SDK's own projection writes the same object.
	return { ...message, content: replacement } as unknown as AgentMessage;
}

function withReplacement(messages: AgentMessage[], edit: ContextEditReplacement | undefined): AgentMessage[] {
	if (edit === undefined) return messages;
	if (edit === null) return [];
	return messages.map((message) => replaceContent(message, edit.content));
}

export async function entryMessages(
	entry: SessionEntry,
	edit: ContextEditReplacement | undefined,
): Promise<PiSessionTranscript> {
	const { sessionEntryToContextMessages } = await loadPiCodingAgent();
	const projected = withReplacement(sessionEntryToContextMessages(entry), edit);
	return mapAgentMessages(projected);
}
