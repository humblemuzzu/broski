import { z } from "zod";
import { SessionRef, StreamEpoch } from "../contract";
import type { CoreLog, ReplacementJournal } from "../core/ports";
import { REPLACEMENT_MEMORY } from "../core/replacements";
import { openJsonLinesJournal } from "./json-lines-journal";

const JournalLine = z.strictObject({
	epoch: StreamEpoch,
	next: SessionRef,
	nextEpoch: StreamEpoch,
	at: z.number().finite(),
});

/** The core's memory of replaced sessions: one record per line, the newest `REPLACEMENT_MEMORY` kept. */
export function openReplacementJournal(path: string, log: CoreLog): ReplacementJournal {
	return openJsonLinesJournal({ path, what: "replacement journal", entry: JournalLine, keep: REPLACEMENT_MEMORY, log });
}
