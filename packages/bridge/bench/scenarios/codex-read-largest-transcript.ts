import { findCodexStateDbPath } from "../../src/connectors/codex/cx-sqlite";
import { getThreadMessagesFromFs } from "../../src/connectors/codex-fs";
import { largestIndexedRollout, listIndexedRollouts } from "../lib/codex-index";
import { runScenario } from "../lib/report";

await runScenario(async () => {
	const dbPath = findCodexStateDbPath();
	if (!dbPath) return { dbPath: "missing" };

	const indexStart = Date.now();
	const indexed = listIndexedRollouts(dbPath);
	const indexMs = Date.now() - indexStart;
	const largest = largestIndexedRollout(indexed);
	if (!largest) return { indexed: indexed.length, found: false };

	const readStart = Date.now();
	const messages = await getThreadMessagesFromFs(largest.id);
	const readMs = Date.now() - readStart;

	let toolCalls = 0;
	let textChars = 0;
	for (const message of messages) {
		toolCalls += message.toolCalls ? message.toolCalls.length : 0;
		textChars += message.text.length;
	}

	return {
		indexMs,
		indexedRollouts: indexed.length,
		found: true,
		threadId: largest.id,
		rolloutBytes: largest.bytes,
		readMs,
		messages: messages.length,
		toolCalls,
		textChars,
		rssBytes: process.memoryUsage.rss(),
	};
});
