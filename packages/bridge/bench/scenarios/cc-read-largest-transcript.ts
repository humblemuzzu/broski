import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getSessionMessages } from "../../src/connectors/claude-code";
import { runScenario } from "../lib/report";
import { largestFile } from "../lib/walk";

const LIMIT = 200;

await runScenario(async () => {
	const root = join(homedir(), ".claude", "projects");
	const scanStart = Date.now();
	const largest = await largestFile(root, (path) => path.endsWith(".jsonl"));
	const scanMs = Date.now() - scanStart;
	if (!largest) return { found: false, scanMs };

	const transcript = await largestFile(root, (path) => path.endsWith(".jsonl") && !path.includes("/subagents/"));
	const target = transcript ?? largest;

	const sessionId = basename(target.path).replace(/\.jsonl$/, "");
	const readStart = Date.now();
	const messages = await getSessionMessages(sessionId, undefined, LIMIT);
	const readMs = Date.now() - readStart;

	return {
		found: true,
		scanMs,
		readMs,
		sessionId,
		fileBytes: target.bytes,
		isSubagentFile: target.path.includes("/subagents/"),
		messages: messages.length,
		rssBytes: process.memoryUsage.rss(),
	};
});
