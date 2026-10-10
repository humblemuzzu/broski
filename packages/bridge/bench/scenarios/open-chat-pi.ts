import { homedir } from "node:os";
import { join } from "node:path";
import { readPiSessionTranscriptPage } from "../../src/connectors/pi/pi-session-page";
import { readPiSessionTranscript } from "../../src/connectors/pi/pi-session-transcript";
import { runScenario } from "../lib/report";
import { largestFile } from "../lib/walk";

/** Page the app opens a chat with. */
const PAGE_LIMIT = Number(process.env.OPEN_CHAT_LIMIT ?? 80);

await runScenario(async () => {
	const mode = process.env.OPEN_CHAT_MODE === "legacy" ? "legacy" : "paged";
	const root = join(homedir(), ".pi", "agent", "sessions");
	const largest = await largestFile(root, (path) => path.endsWith(".jsonl"));
	if (!largest) return { found: false };

	const started = Date.now();
	const messages =
		mode === "legacy"
			? await readPiSessionTranscript(largest.path)
			: ((await readPiSessionTranscriptPage(largest.path, { limit: PAGE_LIMIT }))?.messages ?? []);
	const openMs = Date.now() - started;

	return {
		found: true,
		mode,
		path: largest.path,
		fileBytes: largest.bytes,
		limit: mode === "legacy" ? 0 : PAGE_LIMIT,
		openMs,
		messages: messages.length,
		responseBytes: Buffer.byteLength(JSON.stringify(messages), "utf8"),
		rssBytes: process.memoryUsage.rss(),
	};
});
