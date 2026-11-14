/**
 * The frames the spike recorded from the real CLI (`fixtures/frames/<scenario>.jsonl`, re-recorded at every pin bump), read back for table
 * tests. Temp paths read `<TMP>` and UUIDs are stable placeholders; the frames are otherwise what `query()` yielded.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FRAMES_DIR } from "../spike/rig/frames";

export function frameScenarios(): string[] {
	return readdirSync(FRAMES_DIR)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => name.replace(/\.jsonl$/, ""))
		.sort();
}

export function readFrameFixture(scenario: string): SDKMessage[] {
	const text = readFileSync(join(FRAMES_DIR, `${scenario}.jsonl`), "utf8");
	return text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line): SDKMessage => JSON.parse(line));
}
