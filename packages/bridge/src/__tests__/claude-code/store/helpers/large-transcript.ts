/** A transcript of a chosen size, written in chunks: turns of a prompt, a tool call, its result and an answer. */

import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertTempClaudePath } from "../../../helpers/claude-home";
import { projectKey } from "../../helpers/fixture-transcripts";

export interface LargeTranscript {
	readonly sessionId: string;
	readonly path: string;
	readonly entries: number;
	readonly bytes: number;
	readonly lastUuid: string;
}

const FILLER = "The quick brown fox jumps over the lazy dog. ".repeat(40);

export function writeLargeTranscript(
	configDir: string,
	cwd: string,
	options: { targetBytes: number; compactAfterTurn?: number },
): LargeTranscript {
	assertTempClaudePath(configDir, "CLAUDE_CONFIG_DIR");
	const sessionId = crypto.randomUUID();
	const dir = join(configDir, "projects", projectKey(cwd));
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${sessionId}.jsonl`);
	writeFileSync(path, "");
	const base = { sessionId, cwd: realpathSync(cwd), version: "2.1.316", isSidechain: false, userType: "external" };
	let parent: string | null = null;
	let entries = 0;
	let bytes = 0;
	let clock = Date.UTC(2026, 10, 1);
	let buffer: string[] = [];
	const add = (type: string, body: Record<string, unknown>): string => {
		const uuid = crypto.randomUUID();
		clock += 1000;
		const line = JSON.stringify({
			...base,
			type,
			uuid,
			parentUuid: parent,
			timestamp: new Date(clock).toISOString(),
			...body,
		});
		buffer.push(line);
		bytes += line.length + 1;
		entries += 1;
		parent = uuid;
		return uuid;
	};
	const flush = () => {
		appendFileSync(path, `${buffer.join("\n")}\n`);
		buffer = [];
	};
	for (let turn = 0; bytes < options.targetBytes; turn++) {
		if (turn === options.compactAfterTurn)
			compact(
				add,
				() => parent,
				(value) => (parent = value),
			);
		add("user", { message: { role: "user", content: `turn ${turn}: please look into it` } });
		const call = `toolu_${turn}`;
		const message = `msg_${turn}`;
		add("assistant", {
			message: assistant(message, { type: "tool_use", id: call, name: "Read", input: { file_path: `/f${turn}` } }),
		});
		add("user", { message: { role: "user", content: [{ type: "tool_result", tool_use_id: call, content: FILLER }] } });
		add("assistant", { message: assistant(`${message}b`, { type: "text", text: `${FILLER} (${turn})` }) });
		if (buffer.length >= 400) flush();
	}
	flush();
	return { sessionId, path, entries, bytes, lastUuid: parent ?? "" };
}

function assistant(id: string, block: unknown): Record<string, unknown> {
	return { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [block], stop_reason: null };
}

function compact(
	add: (type: string, body: Record<string, unknown>) => string,
	current: () => string | null,
	reset: (value: string | null) => void,
): void {
	const before = current();
	reset(null);
	add("system", {
		subtype: "compact_boundary",
		logicalParentUuid: before,
		compactMetadata: { trigger: "auto", preTokens: 1, postTokens: 1 },
	});
	add("user", { isCompactSummary: true, message: { role: "user", content: "The conversation so far, summarised." } });
}
