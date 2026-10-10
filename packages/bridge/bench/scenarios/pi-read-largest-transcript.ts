import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	buildSessionContext,
	type FileEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { mapAgentMessages } from "../../src/connectors/pi/pi-events";
import { runScenario } from "../lib/report";
import { largestFile } from "../lib/walk";

const LIMIT = 200;

await runScenario(async () => {
	const root = join(homedir(), ".pi", "agent", "sessions");
	const scanStart = Date.now();
	const largest = await largestFile(root, (path) => path.endsWith(".jsonl"));
	const scanMs = Date.now() - scanStart;
	if (!largest) {
		return { scanMs, found: false };
	}

	const readStart = Date.now();
	const content = await readFile(largest.path, "utf-8");
	const fileEntries = parseSessionEntries(content);

	const entries: SessionEntry[] = [];
	for (const entry of fileEntries) {
		if ((entry as FileEntry).type !== "session") {
			entries.push(entry as SessionEntry);
		}
	}
	migrateSessionEntries(fileEntries);

	const context = buildSessionContext(entries);
	const messages = mapAgentMessages(context.messages);
	const limited = messages.length > LIMIT ? messages.slice(-LIMIT) : messages;
	const readMs = Date.now() - readStart;

	return {
		found: true,
		scanMs,
		readMs,
		path: largest.path,
		fileBytes: largest.bytes,
		contentChars: content.length,
		totalMessages: messages.length,
		returnedMessages: limited.length,
		rssBytes: process.memoryUsage.rss(),
	};
});
