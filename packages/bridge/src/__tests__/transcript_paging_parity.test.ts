/**
 * Parity of the paged transcript readers against the whole-file read.
 *
 * Pages must concatenate to exactly the transcript the unpaged reader returns, and a cursor must
 * keep naming the same older messages when the file grows at the end between pages. A page also
 * starts at the prompt that opened its oldest turn, so no page opens on an answer whose question
 * is on a page the reader has not loaded.
 *
 * The real-session block is read-only and skips itself without ~/.claude data.
 * The largest files (a 400 MB session costs 1.6 GB to read whole) need TRANSCRIPT_PARITY_REAL=1.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { legacyGetSessionMessages } from "../../bench/lib/cc-legacy-transcript-oracle";
import { buildTranscriptMessages, readCcTranscriptPage } from "../connectors/claude-code/cc-transcript";

const REAL_ENABLED = process.env.TRANSCRIPT_PARITY_REAL === "1";
const PAGE_LIMITS = [1, 2, 3, 5, 8, 40];
const SMALL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const REAL_FILE_LIMIT_BYTES = 64 * 1024 * 1024;

let root = "";

async function tempRoot(name: string): Promise<string> {
	root = await mkdtemp(join(tmpdir(), `broski-${name}-`));
	return root;
}

/** Walks every page from the tail and returns them oldest-first, i.e. the whole transcript. */
async function concatPages<T>(
	fetch: (cursor: string | undefined) => Promise<{ messages: T[]; hasMore: boolean; nextCursor?: string } | null>,
): Promise<{ messages: T[]; pages: number }> {
	const pages: T[][] = [];
	let cursor: string | undefined;
	for (let attempt = 0; attempt < 500; attempt++) {
		const page = await fetch(cursor);
		expect(page, "reader could not build a page").not.toBeNull();
		if (!page) break;
		// A page can run past `limit`: it starts at the prompt that opened its oldest turn.
		if (page.hasMore) expect(page.messages.length).toBeGreaterThan(0);
		pages.unshift(page.messages);
		if (!page.hasMore) {
			expect(page.nextCursor).toBeUndefined();
			return { messages: pages.flat(), pages: pages.length };
		}
		expect(page.nextCursor, "hasMore without a cursor").toBeDefined();
		cursor = page.nextCursor;
	}
	throw new Error("paging did not terminate");
}

describe("Claude Code transcript paging parity", () => {
	it("concatenates to the whole-file read", async () => {
		const dir = await tempRoot("cc-paging");
		const stamp = "2026-03-09T12:00:00.000Z";
		const user = (id: string, text: string) => ({
			type: "user",
			uuid: id,
			timestamp: stamp,
			message: { role: "user", content: [{ type: "text", text }] },
		});
		const assistant = (id: string, toolUseId?: string) => ({
			type: "assistant",
			uuid: id,
			timestamp: stamp,
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: `text ${id}` },
					...(toolUseId ? [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: "/tmp/a.ts" } }] : []),
				],
			},
		});
		const toolResult = (id: string, toolUseId: string, text: string) => ({
			type: "user",
			uuid: id,
			timestamp: stamp,
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text }] }],
			},
			toolUseResult: { filePath: "/tmp/a.ts", structuredPatch: [{ lines: ["+a", "-b"] }] },
		});

		const records: unknown[] = [];
		for (let turn = 0; turn < 20; turn++) {
			records.push(user(`u${turn}`, `prompt ${turn}`), assistant(`a${turn}`, `tool-${turn}`));
			for (let result = 0; result < 3; result++)
				records.push(toolResult(`r${turn}-${result}`, `tool-${turn}`, `out ${result}`));
		}
		records.push(user("u-last", "<command-name>/help</command-name>"), assistant("a-last"));

		const path = join(dir, "session.jsonl");
		await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

		const expected = await buildTranscriptMessages(path);
		expect(expected.length).toBeGreaterThan(20);
		for (const limit of PAGE_LIMITS) {
			const { messages } = await concatPages((before) =>
				readCcTranscriptPage(path, { limit, end: before === undefined ? undefined : Number.parseInt(before, 10) }),
			);
			expect(messages, `limit=${limit}`).toEqual(expected);
		}
		expect(await legacyGetSessionMessages(path)).toEqual(expected);
	});

	it("starts the newest page at the prompt that opened its turn", async () => {
		const dir = await tempRoot("cc-paging-turn");
		const line = (uuid: string, role: "user" | "assistant", text: string) => ({
			type: role,
			uuid,
			timestamp: "2026-03-09T12:00:00.000Z",
			message: { role, content: [{ type: "text", text }] },
		});
		const records: unknown[] = [];
		for (let turn = 0; turn < 8; turn++) {
			records.push(line(`u${turn}`, "user", `prompt ${turn}`), line(`a${turn}`, "assistant", `reply ${turn}`));
		}
		const path = join(dir, "turns.jsonl");
		await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

		const page = await readCcTranscriptPage(path, { limit: 3 });
		expect(page?.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
		expect(page?.messages[0]?.id).toBe("u6");
		expect(page?.nextCursor).toBe("12");

		const { messages } = await concatPages((before) =>
			readCcTranscriptPage(path, { limit: 3, end: before === undefined ? undefined : Number.parseInt(before, 10) }),
		);
		expect(messages).toEqual(await buildTranscriptMessages(path));
	});

	it("keeps older pages on the same messages when the file grows at the end", async () => {
		const dir = await tempRoot("cc-paging-append");
		const line = (uuid: string, role: "user" | "assistant", text: string) =>
			JSON.stringify({
				type: role,
				uuid,
				timestamp: "2026-03-09T12:00:00.000Z",
				message: { role, content: [{ type: "text", text }] },
			});
		const records: string[] = [];
		for (let index = 0; index < 30; index++) {
			records.push(line(`u${index}`, "user", `prompt ${index}`), line(`a${index}`, "assistant", `reply ${index}`));
		}
		const path = join(dir, "growing.jsonl");
		await writeFile(path, `${records.join("\n")}\n`);
		const original = await buildTranscriptMessages(path);

		const first = await readCcTranscriptPage(path, { limit: 6 });
		expect(first?.hasMore).toBe(true);

		const grown = [
			...records,
			line("u-appended", "user", "later prompt"),
			line("a-appended", "assistant", "later reply"),
		];
		await writeFile(path, `${grown.join("\n")}\n`);

		const second = await readCcTranscriptPage(path, {
			limit: 6,
			end: first?.nextCursor === undefined ? undefined : Number.parseInt(first.nextCursor, 10),
		});
		expect(second?.messages).toEqual(original.slice(original.length - 12, original.length - 6));
	});
});

type RealFile = { path: string; size: number };

async function collectFiles(dir: string, matches: (name: string) => boolean, depth = 0): Promise<RealFile[]> {
	const found: RealFile[] = [];
	let names: string[] = [];
	try {
		names = await readdir(dir);
	} catch {
		return found;
	}
	for (const name of names) {
		const path = join(dir, name);
		let info: Awaited<ReturnType<typeof stat>>;
		try {
			info = await stat(path);
		} catch {
			continue;
		}
		if (info.isDirectory()) {
			if (depth < 4) found.push(...(await collectFiles(path, matches, depth + 1)));
		} else if (matches(name)) {
			found.push({ path, size: info.size });
		}
	}
	return found;
}

function selectedBySize(files: RealFile[], count: number): RealFile[] {
	const limit = REAL_ENABLED ? REAL_FILE_LIMIT_BYTES : SMALL_FILE_LIMIT_BYTES;
	const small = files.filter((file) => file.size > 0 && file.size <= limit);
	return small.sort((a, b) => b.size - a.size).slice(0, count);
}

describe("paged transcript parity on real sessions", () => {
	it("matches the whole-file read on this machine's Claude Code sessions", async () => {
		const files = await collectFiles(join(homedir(), ".claude", "projects"), (name) => name.endsWith(".jsonl"));
		if (files.length === 0) {
			console.warn("[transcript-paging] no ~/.claude/projects on this machine — skipped");
			return;
		}
		const selected = selectedBySize(files, 4);
		for (const file of selected) {
			const expected = await buildTranscriptMessages(file.path);
			const { messages } = await concatPages((before) =>
				readCcTranscriptPage(file.path, {
					limit: 20,
					end: before === undefined ? undefined : Number.parseInt(before, 10),
				}),
			);
			expect(messages, file.path).toEqual(expected);
		}
		console.log(
			`[transcript-paging] Claude Code: ${selected.length} session(s), largest ${(selected[0]?.size ?? 0) / 1e6} MB`,
		);
	}, 300_000);
});
