/**
 * The pre-optimisation Pi transcript read, kept verbatim in behaviour so parity tests can diff the
 * bounded reader against it. Whole-file read, whole-file parse, slice — deliberately.
 */

import { readFile } from "node:fs/promises";
import {
	buildSessionContext,
	type FileEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { mapAgentMessages } from "../../src/connectors/pi/pi-events";

export async function legacyReadPiSessionMessages(
	sessionPath: string,
	limit?: number,
): Promise<ReturnType<typeof mapAgentMessages>> {
	const content = await readFile(sessionPath, "utf-8");
	const fileEntries = parseSessionEntries(content);

	const entries: SessionEntry[] = [];
	for (const entry of fileEntries) {
		if ((entry as FileEntry).type !== "session") {
			entries.push(entry as SessionEntry);
		}
	}

	migrateSessionEntries(fileEntries);

	const messages = mapAgentMessages(buildSessionContext(entries).messages);
	if (limit && limit > 0 && messages.length > limit) return messages.slice(-limit);
	return messages;
}
