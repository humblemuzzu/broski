/** The items of a `system` entry (D26): a run boundary, a command's output, or a notice, from what the raw file says of it. */

import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { MAX_TEXT_CHARS, type TranscriptItem } from "../../../contract";
import { clip } from "../bounds";
import { commandOutputActivity } from "../mapping/activities";
import { entryTimestamp } from "./message-parts";
import type { SystemFact } from "./system-facts";

export function systemItems(message: SessionMessage, fact: SystemFact | undefined): TranscriptItem[] {
	if (fact === undefined) return [];
	const at = entryTimestamp(message);
	const base = { id: message.uuid, ...(at !== undefined && { at }) };
	if (fact.subtype === "turn_duration") return [{ kind: "run_boundary", ...base, outcome: { kind: "completed" } }];
	if (fact.subtype === "compact_boundary" || fact.text === undefined || fact.text === "") return [];
	if (fact.subtype === "local_command") {
		const activity = commandOutputActivity(fact.text, fact.level === "error");
		return activity === undefined ? [] : [{ kind: "activity", ...base, activity }];
	}
	return [{ kind: "notice", ...base, level: fact.level, text: clip(fact.text, MAX_TEXT_CHARS) }];
}
