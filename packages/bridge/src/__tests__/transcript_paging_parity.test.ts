/**
 * Parity of the paged transcript readers against the whole-file read.
 *
 * Pages must concatenate to exactly the transcript the unpaged reader returns, and a cursor must
 * keep naming the same older messages when the file grows at the end between pages.
 *
 * The real-session block is read-only and skips itself without ~/.pi, ~/.codex or ~/.claude data.
 * The largest files (a 400 MB Pi session costs 1.6 GB to read whole) need TRANSCRIPT_PARITY_REAL=1.
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { legacyGetSessionMessages } from "../../bench/lib/cc-legacy-transcript-oracle";
import {
	appendChain,
	branchSummary,
	chain,
	compaction,
	contextEdit,
	type Entry,
	header,
	assistant as piAssistant,
	user as piUser,
	usage,
	writeSession,
} from "../../bench/lib/pi-synthetic-sessions";
import { buildTranscriptMessages, readCcTranscriptPage } from "../connectors/claude-code/cc-transcript";
import { readCxTranscript, readCxTranscriptPage } from "../connectors/codex/cx-transcript";
import { readPiSessionTranscriptPage } from "../connectors/pi/pi-session-page";
import { readPiSessionTranscript } from "../connectors/pi/pi-session-transcript";
import { normalizeTranscript } from "./codex_legacy_reference";

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
		// A page can run past `limit`: Pi extends a page backwards past a run of tool results so
		// the app can attach them to the assistant message before them.
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

describe("Pi transcript paging parity", () => {
	it("concatenates to the whole-file read on every session shape", async () => {
		const dir = await tempRoot("pi-paging");

		const linear: Entry[] = [header(), ...chain(24)];
		const branched: Entry[] = [header(), ...chain(12)];
		appendChain(branched, 6, "side", "m8");
		const branchedTip = appendChain(branched, 2, "tail", "m11");
		branched.push(branchSummary("bs1", branchedTip, "side5"));

		const cut = chain(30);
		const compacted: Entry[] = [header(), ...cut, compaction("c1", cut[29]?.id as string, cut[24]?.id as string)];
		appendChain(compacted, 6, "post", "c1");

		const double: Entry[] = [header(), ...chain(28)];
		double.push(compaction("c-early", "m10", "m6"));
		const midTip = appendChain(double, 12, "mid", "c-early");
		double.push(compaction("c-late", midTip, "mid8"));
		appendChain(double, 4, "end", "c-late");

		const mixed: Entry[] = [header()];
		let parent: string | null = null;
		for (let index = 0; index < 18; index++) {
			const id = `n${index}`;
			if (index % 3 === 2) mixed.push(usage(id, parent));
			else
				mixed.push(
					index % 2 === 0 ? piUser(id, parent, `user ${index}`) : piAssistant(id, parent, `assistant ${index}`),
				);
			parent = id;
		}

		const sessions: [string, Entry[]][] = [
			["linear.jsonl", linear],
			["branched.jsonl", branched],
			["compacted.jsonl", compacted],
			["double-compaction.jsonl", double],
			["mixed.jsonl", mixed],
		];

		for (const [name, entries] of sessions) {
			const path = await writeSession(dir, name, entries);
			const expected = await readPiSessionTranscript(path);
			for (const limit of PAGE_LIMITS) {
				const { messages } = await concatPages((before) => readPiSessionTranscriptPage(path, { limit, before }));
				expect(messages, `${name} limit=${limit}`).toEqual(expected);
			}
		}
	});

	it("keeps older pages on the same messages when the session grows at the end", async () => {
		const dir = await tempRoot("pi-paging-append");
		const entries: Entry[] = [header(), ...chain(40)];
		const path = await writeSession(dir, "growing.jsonl", entries);
		const original = await readPiSessionTranscript(path);

		const first = await readPiSessionTranscriptPage(path, { limit: 10 });
		expect(first?.hasMore).toBe(true);

		const grown = [...entries];
		appendChain(grown, 6, "appended", (entries[entries.length - 1]?.id as string) ?? null);
		await writeFile(path, `${grown.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

		const second = await readPiSessionTranscriptPage(path, { limit: 10, before: first?.nextCursor });
		expect(second).not.toBeNull();
		expect(second?.messages).toEqual(original.slice(original.length - 20, original.length - 10));
	});

	it("falls back on a session it cannot page window-by-window", async () => {
		const dir = await tempRoot("pi-paging-fallback");
		const base = chain(20);
		const entries: Entry[] = [header(), ...base];
		entries.push(contextEdit("e1", base[19]?.id as string, base[3]?.id as string, { content: "rewritten" }));
		const path = await writeSession(dir, "edited.jsonl", entries);
		expect(await readPiSessionTranscriptPage(path, { limit: 5 })).toBeNull();

		expect(await readPiSessionTranscriptPage(path, { limit: 5, before: "no-such-entry" })).toBeNull();

		const v2 = await writeSession(dir, "v2.jsonl", [header(2), ...chain(8)]);
		expect(await readPiSessionTranscriptPage(v2, { limit: 5 })).toBeNull();
	});
});

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

describe("Codex transcript paging parity", () => {
	function rollout(turns: number): string {
		const lines: string[] = [JSON.stringify({ type: "session_meta", payload: { id: "t1", cwd: "/tmp/work" } })];
		for (let turn = 0; turn < turns; turn++) {
			lines.push(JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: `prompt ${turn}` } }));
			lines.push(
				JSON.stringify({
					type: "response_item",
					payload: { type: "reasoning", summary: [{ text: `thinking ${turn}` }] },
				}),
			);
			lines.push(
				JSON.stringify({
					type: "response_item",
					payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `reply ${turn}` }] },
				}),
			);
			lines.push(
				JSON.stringify({
					type: "response_item",
					payload: { type: "function_call", name: "shell_command", call_id: `c${turn}`, arguments: '{"command":"ls"}' },
				}),
			);
			lines.push(
				JSON.stringify({
					type: "response_item",
					payload: { type: "function_call_output", call_id: `c${turn}`, output: `out ${turn}` },
				}),
			);
			lines.push(
				JSON.stringify({
					type: "response_item",
					payload: {
						type: "custom_tool_call",
						name: "apply_patch",
						call_id: `p${turn}`,
						status: "completed",
						input: "*** Update File: /tmp/a.ts\n+a\n-b\n",
					},
				}),
			);
		}
		return `${lines.join("\n")}\n`;
	}

	it("concatenates to the whole-file transcript", async () => {
		const dir = await tempRoot("cx-paging");
		for (const turns of [1, 4, 25]) {
			const path = join(dir, `rollout-${turns}.jsonl`);
			await writeFile(path, rollout(turns));
			const expected = normalizeTranscript(await readCxTranscript(path, { limit: 100_000 }));
			expect(expected.length).toBeGreaterThan(turns);
			for (const limit of PAGE_LIMITS) {
				const { messages } = await concatPages((before) =>
					readCxTranscriptPage(path, { limit, end: before === undefined ? undefined : Number.parseInt(before, 10) }),
				);
				expect(normalizeTranscript(messages), `turns=${turns} limit=${limit}`).toEqual(expected);
			}
		}
	});

	it("keeps older pages on the same messages when the rollout grows at the end", async () => {
		const dir = await tempRoot("cx-paging-append");
		const path = join(dir, "growing.jsonl");
		await writeFile(path, rollout(20));
		const original = normalizeTranscript(await readCxTranscript(path, { limit: 100_000 }));

		const first = await readCxTranscriptPage(path, { limit: 7 });
		expect(first?.hasMore).toBe(true);

		const appended = rollout(2).trimEnd().split("\n").slice(1).join("\n");
		await writeFile(path, `${rollout(20).trimEnd()}\n${appended}\n`);

		const second = await readCxTranscriptPage(path, {
			limit: 7,
			end: first?.nextCursor === undefined ? undefined : Number.parseInt(first.nextCursor, 10),
		});
		expect(normalizeTranscript(second?.messages ?? [])).toEqual(
			original.slice(original.length - 14, original.length - 7),
		);
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

function largestFile(files: RealFile[]): RealFile | null {
	const sized = files.filter((file) => file.size > 0).sort((a, b) => b.size - a.size);
	return sized[0] ?? null;
}

/**
 * Walks pages from the tail and returns them oldest-first, without holding more than the pages it
 * walked — a whole transcript of a multi-hundred-megabyte session does not fit the RSS cap.
 */
async function walkPages(
	fetch: (cursor: string | undefined) => Promise<{ messages: unknown[]; hasMore: boolean; nextCursor?: string } | null>,
	pages: number,
): Promise<unknown[]> {
	const collected: unknown[] = [];
	let cursor: string | undefined;
	for (let attempt = 0; attempt < pages; attempt++) {
		const page = await fetch(cursor);
		expect(page, "reader could not build a page").not.toBeNull();
		if (!page) break;
		collected.unshift(...page.messages);
		if (!page.hasMore) break;
		cursor = page.nextCursor;
	}
	return collected;
}

describe("paged transcript parity on real sessions", () => {
	it("matches the whole-file read on this machine's Pi sessions", async () => {
		const files = await collectFiles(join(homedir(), ".pi", "agent", "sessions"), (name) => name.endsWith(".jsonl"));
		if (files.length === 0) {
			console.warn("[transcript-paging] no ~/.pi/agent/sessions on this machine — skipped");
			return;
		}
		const selected = selectedBySize(files, 6);
		let paged = 0;
		for (const file of selected) {
			if ((await readPiSessionTranscriptPage(file.path, { limit: 40 })) === null) {
				// A session the bounded reader cannot page is answered whole, exactly as before.
				console.log(`[transcript-paging] Pi: ${file.path} cannot be paged, the bridge sends it whole`);
				continue;
			}
			const expected = await readPiSessionTranscript(file.path);
			for (const limit of [5, 40]) {
				const { messages, pages } = await concatPages((before) =>
					readPiSessionTranscriptPage(file.path, { limit, before }),
				);
				if (pages === 1) continue;
				expect(messages, `${file.path} limit=${limit}`).toEqual(expected);
			}
			paged++;
		}
		expect(paged).toBeGreaterThan(0);
		console.log(
			`[transcript-paging] Pi: ${paged}/${selected.length} paged, largest ${(selected[0]?.size ?? 0) / 1e6} MB`,
		);
	}, 300_000);

	it("matches the whole-file read on this machine's Codex rollouts", async () => {
		const files = await collectFiles(join(homedir(), ".codex", "sessions"), (name) => name.endsWith(".jsonl"));
		if (files.length === 0) {
			console.warn("[transcript-paging] no ~/.codex/sessions on this machine — skipped");
			return;
		}
		const selected = selectedBySize(files, 4);
		for (const file of selected) {
			const expected = normalizeTranscript(await readCxTranscript(file.path, { limit: 100_000 }));
			const { messages } = await concatPages((before) =>
				readCxTranscriptPage(file.path, {
					limit: 20,
					end: before === undefined ? undefined : Number.parseInt(before, 10),
				}),
			);
			expect(normalizeTranscript(messages), file.path).toEqual(expected);
		}
		console.log(
			`[transcript-paging] Codex: ${selected.length} rollout(s), largest ${(selected[0]?.size ?? 0) / 1e6} MB`,
		);
	}, 600_000);

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

	// A whole-file read of a 400 MB session peaks near 2 GB, so the largest files are compared a
	// page at a time against the bounded tail reader instead of against the whole transcript.
	describe.skipIf(!REAL_ENABLED)("largest files, page by page", () => {
		it("pages the largest Pi session to the same messages as the bounded tail read", async () => {
			const files = await collectFiles(join(homedir(), ".pi", "agent", "sessions"), (name) => name.endsWith(".jsonl"));
			const file = largestFile(files);
			if (!file) return;

			const span = 120;
			const tail = await readPiSessionTranscript(file.path, span);
			expect(tail.length).toBe(span);

			const collected = await walkPages((before) => readPiSessionTranscriptPage(file.path, { limit: 60, before }), 8);
			expect(collected.length).toBeGreaterThanOrEqual(span);
			expect(collected.slice(collected.length - span)).toEqual(tail);
			console.log(
				`[transcript-paging] Pi largest ${(file.size / 1e6).toFixed(0)} MB: ${collected.length} messages in pages`,
			);
		}, 300_000);

		it("pages the largest Codex rollout to the same messages as the bounded tail read", async () => {
			const files = await collectFiles(join(homedir(), ".codex", "sessions"), (name) => name.endsWith(".jsonl"));
			const file = largestFile(files);
			if (!file) return;

			const tail = await readCxTranscript(file.path, { limit: 120 });
			expect(tail.length).toBeGreaterThan(0);

			const collected = await walkPages(
				(before) =>
					readCxTranscriptPage(file.path, {
						limit: 60,
						end: before === undefined ? undefined : Number.parseInt(before, 10),
					}),
				8,
			);
			expect(collected.length).toBeGreaterThanOrEqual(tail.length);
			expect(normalizeTranscript(collected.slice(0, tail.length) as never)).toEqual(normalizeTranscript(tail));
			console.log(
				`[transcript-paging] Codex largest ${(file.size / 1e6).toFixed(0)} MB: ${collected.length} messages in pages`,
			);
		}, 300_000);
	});
});
