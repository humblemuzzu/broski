/**
 * Synthetic Pi session files for parity tests: a v3 header, messages, compaction, context-edit,
 * branch-summary, custom, usage and system entries, plus a helper that writes them as JSONL.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Entry = Record<string, unknown>;

let clock = 0;

export const stamp = (): string => {
	clock += 1;
	return `2026-01-01T00:00:${String(clock % 60).padStart(2, "0")}.000Z`;
};

export const nowMs = (): number => clock;

export const header = (version = 3): Entry => ({
	type: "session",
	version,
	id: "session-1",
	timestamp: "2026-01-01T00:00:00.000Z",
	cwd: "/tmp/work",
});

export const user = (id: string, parentId: string | null, text: string): Entry => ({
	type: "message",
	id,
	parentId,
	timestamp: stamp(),
	message: { role: "user", content: text, timestamp: clock },
});

export const assistant = (id: string, parentId: string | null, text: string): Entry => ({
	type: "message",
	id,
	parentId,
	timestamp: stamp(),
	message: {
		role: "assistant",
		model: "m",
		provider: "p",
		content: [{ type: "text", text }],
		usage: { input: 1, output: 1, totalTokens: 2 },
		stopReason: "stop",
		timestamp: clock,
	},
});

export const system = (id: string, parentId: string | null): Entry => ({
	type: "message",
	id,
	parentId,
	timestamp: stamp(),
	message: { role: "system", content: "prompt", sections: {}, timestamp: clock },
});

export const custom = (id: string, parentId: string | null): Entry => ({
	type: "custom",
	id,
	parentId,
	timestamp: stamp(),
	customType: "state",
	data: { n: 1 },
});

export const usage = (id: string, parentId: string | null): Entry => ({
	type: "usage",
	id,
	parentId,
	timestamp: stamp(),
	kind: "cache_warm",
	provider: "p",
	model: "m",
	usage: { input: 0, output: 0, totalTokens: 1 },
});

export const compaction = (
	id: string,
	parentId: string | null,
	firstKeptEntryId: string,
	extra: Entry = {},
): Entry => ({
	type: "compaction",
	id,
	parentId,
	timestamp: stamp(),
	summary: "earlier turns summarised",
	firstKeptEntryId,
	tokensBefore: 1000,
	...extra,
});

export const contextEdit = (id: string, parentId: string | null, targetId: string, replacement: unknown): Entry => ({
	type: "context_edit",
	id,
	parentId,
	timestamp: stamp(),
	targetId,
	replacement,
});

export const branchSummary = (id: string, parentId: string | null, fromId: string): Entry => ({
	type: "branch_summary",
	id,
	parentId,
	timestamp: stamp(),
	fromId,
	summary: "abandoned branch",
});

/** Appends `count` linked entries and returns the new tip. */
export function appendChain(entries: Entry[], count: number, prefix: string, fromId: string | null): string {
	let parentId = fromId;
	for (let index = 0; index < count; index++) {
		const id = `${prefix}${index}`;
		entries.push(
			index % 3 === 1 ? assistant(id, parentId, `${prefix} ${index}`) : user(id, parentId, `${prefix} ${index}`),
		);
		parentId = id;
	}
	return parentId ?? "";
}

export function chain(count: number, prefix = "m"): Entry[] {
	const entries: Entry[] = [];
	appendChain(entries, count, prefix, null);
	return entries;
}

export async function writeSession(root: string, name: string, entries: Entry[]): Promise<string> {
	const path = join(root, name);
	await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	return path;
}
