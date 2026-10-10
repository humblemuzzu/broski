import { findCodexStateDbPath } from "../../src/connectors/codex/cx-sqlite";
import { readCxTranscriptPage } from "../../src/connectors/codex/cx-transcript";
import { getThreadMessagesFromFs } from "../../src/connectors/codex-fs";
import { largestIndexedRollout, listIndexedRollouts } from "../lib/codex-index";
import { runScenario } from "../lib/report";

/** Page the app opens a chat with. */
const PAGE_LIMIT = Number(process.env.OPEN_CHAT_LIMIT ?? 80);

await runScenario(async () => {
	const mode = process.env.OPEN_CHAT_MODE === "legacy" ? "legacy" : "paged";
	const dbPath = findCodexStateDbPath();
	if (!dbPath) return { dbPath: "missing" };

	const largest = largestIndexedRollout(listIndexedRollouts(dbPath));
	if (!largest) return { found: false };

	const started = Date.now();
	const messages =
		mode === "legacy"
			? await getThreadMessagesFromFs(largest.id)
			: ((await readCxTranscriptPage(largest.rolloutPath, { limit: PAGE_LIMIT }))?.messages ?? []);
	const openMs = Date.now() - started;

	return {
		found: true,
		mode,
		threadId: largest.id,
		rolloutBytes: largest.bytes,
		limit: mode === "legacy" ? 0 : PAGE_LIMIT,
		openMs,
		messages: messages.length,
		responseBytes: Buffer.byteLength(JSON.stringify(messages), "utf8"),
		rssBytes: process.memoryUsage.rss(),
	};
});
