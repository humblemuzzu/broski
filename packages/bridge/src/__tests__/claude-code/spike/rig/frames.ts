/**
 * Records the SDK messages a scenario received as `fixtures/frames/<scenario>.jsonl`, one JSON per line,
 * for the mapping lane's table tests. Recording happens only with `CC_SPIKE_RECORD=1`, so a normal test
 * run never rewrites the fixtures. Temp paths, the real home and every UUID are normalised: each distinct
 * UUID becomes a stable placeholder UUID, so cross-references between frames survive.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const FRAMES_DIR = join(import.meta.dir, "..", "..", "fixtures", "frames");

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathReplacements(root: string): Array<[RegExp, string]> {
	const tmp = realpathSync(tmpdir());
	const variants: Array<[string, string]> = [
		[root.replace(/[^a-zA-Z0-9]/g, "-"), "<TMP-PROJECT-KEY>"],
		[root, "<TMP>"],
		[root.replace(/^\/private/, ""), "<TMP>"],
		[tmp, "<TMPDIR>"],
		[tmp.replace(/^\/private/, ""), "<TMPDIR>"],
		[homedir(), "<HOME>"],
	];
	return variants.map(([from, to]) => [new RegExp(escapeRegExp(from), "g"), to]);
}

/** Normalises the frames of one scenario; the same input always gives the same lines. */
export function normaliseFrames(messages: readonly SDKMessage[], root: string): string[] {
	const ids = new Map<string, string>();
	const stable = (uuid: string) => {
		const key = uuid.toLowerCase();
		let id = ids.get(key);
		if (!id) {
			id = `00000000-0000-4000-8000-${(ids.size + 1).toString(16).padStart(12, "0")}`;
			ids.set(key, id);
		}
		return id;
	};
	const replacements = pathReplacements(root);
	return messages.map((message) => {
		let line = JSON.stringify(message);
		for (const [pattern, to] of replacements) line = line.replace(pattern, to);
		return line.replace(UUID, stable);
	});
}

export function recordFrames(scenario: string, messages: readonly SDKMessage[], root: string): void {
	if (process.env.CC_SPIKE_RECORD !== "1") return;
	mkdirSync(FRAMES_DIR, { recursive: true });
	const lines = normaliseFrames(messages, root);
	writeFileSync(join(FRAMES_DIR, `${scenario}.jsonl`), `${lines.join("\n")}\n`);
}
