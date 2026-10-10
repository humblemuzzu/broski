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
import { readPiSessionTranscript } from "../../src/connectors/pi/pi-session-transcript";
import { runScenario } from "../lib/report";
import { largestFile } from "../lib/walk";

const LIMIT = 200;

async function legacyRead(path: string, limit: number) {
	const content = await readFile(path, "utf-8");
	const fileEntries = parseSessionEntries(content);

	const entries: SessionEntry[] = [];
	for (const entry of fileEntries) {
		if ((entry as FileEntry).type !== "session") {
			entries.push(entry as SessionEntry);
		}
	}
	migrateSessionEntries(fileEntries);

	const messages = mapAgentMessages(buildSessionContext(entries).messages);
	return {
		contentChars: content.length,
		messages: messages.length > limit ? messages.slice(-limit) : messages,
	};
}

async function boundedRead(path: string, limit: number) {
	const messages = await readPiSessionTranscript(path, limit);
	return { contentChars: 0, messages };
}

await runScenario(async () => {
	const mode = process.env.PI_TRANSCRIPT_MODE === "legacy" ? "legacy" : "bounded";
	const root = join(homedir(), ".pi", "agent", "sessions");
	const scanStart = Date.now();
	const largest = await largestFile(root, (path) => path.endsWith(".jsonl"));
	const scanMs = Date.now() - scanStart;
	if (!largest) {
		return { scanMs, found: false };
	}

	const readStart = Date.now();
	const result = mode === "legacy" ? await legacyRead(largest.path, LIMIT) : await boundedRead(largest.path, LIMIT);
	const readMs = Date.now() - readStart;

	return {
		found: true,
		mode,
		scanMs,
		readMs,
		path: largest.path,
		fileBytes: largest.bytes,
		contentChars: result.contentChars,
		returnedMessages: result.messages.length,
		rssBytes: process.memoryUsage.rss(),
	};
});
