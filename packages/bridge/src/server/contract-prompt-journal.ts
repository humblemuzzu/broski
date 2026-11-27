import { z } from "zod";
import { ClientRequestId, PromptAccepted, SessionRef } from "../contract";
import type { CoreLog, PromptJournal } from "../core/ports";
import { PROMPT_MEMORY } from "../core/prompt-ledger";
import { openJsonLinesJournal } from "./json-lines-journal";

const JournalLine = z.strictObject({ session: SessionRef, clientRequestId: ClientRequestId, result: PromptAccepted });

/** The core's prompt journal: one accepted prompt per line, the newest `PROMPT_MEMORY` kept. */
export function openPromptJournal(path: string, log: CoreLog): PromptJournal {
	return openJsonLinesJournal({
		path,
		what: "prompt journal",
		entry: JournalLine,
		keep: PROMPT_MEMORY,
		log: (message) => log.error(`[core] ${message}`),
	});
}
