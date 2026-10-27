/**
 * Parity of the paged transcript readers against the whole-file read.
 *
 * Pages must concatenate to exactly the transcript the unpaged reader returns, and a cursor must
 * keep naming the same older messages when the file grows at the end between pages. A page also
 * starts at the prompt that opened its oldest turn, so no page opens on an answer whose question
 * is on a page the reader has not loaded.
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
import { readPiSessionHistory, readPiSessionTranscriptPage } from "../connectors/pi/pi-session-page";
import { readPiSessionTranscript } from "../connectors/pi/pi-session-transcript";
import { TURN_EXTENSION_MAX } from "../utils/turn-aligned-page";
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

/** Turns of `length` messages, each opened by a prompt, so a turn start is `index % length == 0`. */
function piTurns(turns: number, length: number): Entry[] {
	const entries: Entry[] = [];
	let parent: string | null = null;
	for (let turn = 0; turn < turns; turn++) {
		for (let index = 0; index < length; index++) {
			const id = `t${turn}-${index}`;
			entries.push(
				index === 0 ? piUser(id, parent, `prompt ${turn}`) : piAssistant(id, parent, `reply ${turn}.${index}`),
			);
			parent = id;
		}
	}
	return entries;
}

const roles = <T extends { role: string }>(messages: T[]): string[] => messages.map((message) => message.role);

const texts = (count: number, prefix: string): string[] =>
	Array.from({ length: count }, (_, index) => `${prefix} ${index}`);

const textOf = (message: Record<string, unknown>): unknown => message.content ?? message.text;

describe("Pi transcript paging parity", () => {
	it("concatenates to the whole-file read when no compaction cuts the path", async () => {
		const dir = await tempRoot("pi-paging");

		const linear: Entry[] = [header(), ...chain(24)];
		const branched: Entry[] = [header(), ...chain(12)];
		appendChain(branched, 6, "side", "m8");
		const branchedTip = appendChain(branched, 2, "tail", "m11");
		branched.push(branchSummary("bs1", branchedTip, "side5"));

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

	it("walks past every compaction to the first prompt", async () => {
		const dir = await tempRoot("pi-paging-compacted");
		const first = chain(30);
		const entries: Entry[] = [header(), ...first, compaction("c1", first[29]?.id as string, first[24]?.id as string)];
		const midTip = appendChain(entries, 12, "mid", "c1");
		entries.push(compaction("c2", midTip, "mid8"));
		appendChain(entries, 4, "end", "c2");

		const path = await writeSession(dir, "two-compactions.jsonl", entries);
		const expected = [
			...texts(30, "m"),
			"earlier turns summarised",
			...texts(12, "mid"),
			"earlier turns summarised",
			...texts(4, "end"),
		];

		for (const limit of PAGE_LIMITS) {
			const { messages } = await concatPages((before) => readPiSessionTranscriptPage(path, { limit, before }));
			expect(messages.map(textOf), `limit=${limit}`).toEqual(expected);
			expect(
				roles(messages).filter((role) => role === "compactionSummary"),
				`limit=${limit}`,
			).toHaveLength(2);
			expect(messages[0]?.role, `limit=${limit}`).toBe("user");
		}
	});

	it("starts the newest page at the prompt that opened its turn", async () => {
		const dir = await tempRoot("pi-paging-turn");
		const path = await writeSession(dir, "turns.jsonl", [header(), ...piTurns(12, 4)]);

		const page = await readPiSessionTranscriptPage(path, { limit: 6 });
		expect(page?.messages[0]).toEqual({
			role: "user",
			content: "prompt 10",
			timestamp: expect.any(Number),
		});
		expect(page?.messages).toHaveLength(8);
		expect(page?.hasMore).toBe(true);

		const { messages } = await concatPages((before) => readPiSessionTranscriptPage(path, { limit: 6, before }));
		expect(messages).toEqual(await readPiSessionTranscript(path));
	});

	it("opens mid-turn when a turn is longer than the bound, and still walks exactly", async () => {
		const dir = await tempRoot("pi-paging-long-turn");
		const entries: Entry[] = [header(), ...piTurns(3, 5)];
		let parent = entries[entries.length - 1]?.id as string;
		entries.push(piUser("long-0", parent, "the long turn"));
		parent = "long-0";
		for (let step = 0; step <= TURN_EXTENSION_MAX + 20; step++) {
			const id = `long-${step + 1}`;
			entries.push(piAssistant(id, parent, `step ${step}`));
			parent = id;
		}
		const path = await writeSession(dir, "long.jsonl", entries);

		const { messages } = await concatPages((before) => readPiSessionTranscriptPage(path, { limit: 10, before }));
		expect(messages).toEqual(await readPiSessionTranscript(path));

		const page = await readPiSessionTranscriptPage(path, { limit: 10 });
		expect(page?.messages[0]?.role).toBe("assistant");
		expect(page?.messages).toHaveLength(10);
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

	it("pages a session with a context edit instead of handing it back whole", async () => {
		const dir = await tempRoot("pi-paging-edited");
		const base = chain(20);
		const entries: Entry[] = [header(), ...base];
		entries.push(contextEdit("e1", base[19]?.id as string, base[3]?.id as string, { content: "rewritten" }));
		const path = await writeSession(dir, "edited.jsonl", entries);

		const { messages } = await concatPages((before) => readPiSessionTranscriptPage(path, { limit: 5, before }));
		expect(messages).toHaveLength(base.length);
		const rewritten = messages.filter((message) => message.content === "rewritten");
		expect(rewritten).toHaveLength(1);
		expect(messages.map((message) => message.content)).not.toContain("m 3");
	});

	it("pages a session whose header this reader has no index for, and one with a looping chain", async () => {
		const dir = await tempRoot("pi-paging-degenerate");
		const v2 = await writeSession(dir, "v2.jsonl", [header(2), ...chain(8)]);
		const v2Page = await readPiSessionTranscriptPage(v2, { limit: 5 });
		expect(v2Page?.messages).toHaveLength(5);
		expect(v2Page?.hasMore).toBe(true);

		const looping = await writeSession(dir, "looping.jsonl", [
			header(),
			...chain(3),
			piUser("dup", "m2", "repeated id"),
		]);
		const loopingPage = await readPiSessionTranscriptPage(looping, { limit: 2 });
		expect(loopingPage?.messages.at(-1)?.content).toBe("repeated id");
	});

	it("answers a cursor that names no entry of this session with the newest page", async () => {
		const dir = await tempRoot("pi-paging-cursor");
		const path = await writeSession(dir, "cursor.jsonl", [header(), ...piTurns(4, 4)]);

		const page = await readPiSessionTranscriptPage(path, { limit: 4, before: "no-such-entry" });
		expect(page?.cursorUnknown).toBe(true);
		expect(page?.messages).toEqual(await lastPageMessages(path, 4));
	});
});

async function lastPageMessages(path: string, limit: number) {
	const page = await readPiSessionTranscriptPage(path, { limit });
	return page?.messages ?? [];
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

	it("names a message after the rollout record that wrote it, whichever window read it", async () => {
		const dir = await tempRoot("cx-identity");
		const path = join(dir, "rollout-identity.jsonl");
		// Codex writes `ordinal` and `timestamp` next to every record; a window of the file and the
		// whole file must therefore agree on what each message is called and when it was written.
		const lines = rollout(6)
			.trim()
			.split("\n")
			.map((line, ordinal) =>
				JSON.stringify({
					...(JSON.parse(line) as Record<string, unknown>),
					ordinal,
					timestamp: "2026-05-31T03:23:35.000Z",
				}),
			);
		await writeFile(path, `${lines.join("\n")}\n`);

		const whole = await readCxTranscript(path, { limit: 100_000 });
		const paged = await walkPages(
			(before) =>
				readCxTranscriptPage(path, {
					limit: 4,
					end: before === undefined ? undefined : Number.parseInt(before, 10),
				}),
			40,
		);

		const byText = new Map(whole.map((message) => [message.text ?? message.id, message]));
		for (const message of paged as typeof whole) {
			const same = byText.get(message.text ?? message.id);
			expect(same, message.text ?? message.id).toBeDefined();
			expect(same?.id).toBe(message.id);
			expect(same?.createdAt).toBe(message.createdAt);
		}
		const written = Math.floor(Date.parse("2026-05-31T03:23:35.000Z") / 1000);
		expect(whole.every((message) => message.createdAt === written)).toBe(true);
	});

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

	it("starts the newest page at the prompt that opened its turn", async () => {
		const dir = await tempRoot("cx-paging-turn");
		const path = join(dir, "turns.jsonl");
		await writeFile(path, rollout(8));

		const page = await readCxTranscriptPage(path, { limit: 3 });
		expect(page?.messages[0]?.role).toBe("user");
		expect(page?.messages).toHaveLength(4);
		expect(page?.nextCursor).toBe("12");

		const { messages } = await concatPages((before) =>
			readCxTranscriptPage(path, { limit: 3, end: before === undefined ? undefined : Number.parseInt(before, 10) }),
		);
		expect(normalizeTranscript(messages)).toEqual(
			normalizeTranscript(await readCxTranscript(path, { limit: 100_000 })),
		);
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
		const walked = normalizeTranscript([...(second?.messages ?? []), ...(first?.messages ?? [])]);
		expect(walked.length).toBeGreaterThan(second?.messages.length ?? 0);
		expect(walked).toEqual(original.slice(original.length - walked.length));
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

/** A message the bridge had to cut down to fit a page matches the text it was cut from. */
const CUT_AT = "…[truncated by the bridge: ";

function sameTranscript(actual: unknown, expected: unknown): boolean {
	if (typeof actual === "string" && typeof expected === "string") {
		const cut = actual.lastIndexOf(CUT_AT);
		return cut === -1 ? actual === expected : expected.startsWith(actual.slice(0, cut));
	}
	if (Array.isArray(actual) && Array.isArray(expected)) {
		return actual.length === expected.length && actual.every((item, index) => sameTranscript(item, expected[index]));
	}
	if (actual && expected && typeof actual === "object" && typeof expected === "object") {
		const left = actual as Record<string, unknown>;
		const right = expected as Record<string, unknown>;
		const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
		for (const key of keys) if (!sameTranscript(left[key], right[key])) return false;
		return true;
	}
	return actual === expected;
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
			// A page is the whole leaf-to-root history with each compaction kept as a marker, which is
			// deliberately not what the unpaged read returns: that one is the agent's compaction-cut
			// context, and the bounded-reader suite pins it to the pre-optimisation behaviour. The
			// pages are measured here against the same history read in one window instead.
			const expected = await readPiSessionHistory(file.path);
			if (expected === null) continue;
			for (const limit of [5, 40]) {
				const { messages, pages } = await concatPages((before) =>
					readPiSessionTranscriptPage(file.path, { limit, before }),
				);
				if (pages === 1) continue;
				expect(messages.length, `${file.path} limit=${limit}`).toBeGreaterThanOrEqual(expected.length);
				expect(sameTranscript(messages.slice(-expected.length), expected), `${file.path} limit=${limit}`).toBe(true);
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
			const history = await readPiSessionHistory(file.path);
			expect(history, file.path).not.toBeNull();
			if (!history) return;
			const tail = history.slice(-span);
			expect(tail.length).toBe(span);

			const collected = await walkPages((before) => readPiSessionTranscriptPage(file.path, { limit: 60, before }), 8);
			expect(collected.length).toBeGreaterThanOrEqual(span);
			// A page carries what fit its byte budget, so a message over it is cut and marked.
			expect(sameTranscript(collected.slice(collected.length - span), tail)).toBe(true);
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
			// The pages are the whole history; the tail read is its newest end.
			expect(
				sameTranscript(
					normalizeTranscript(collected.slice(collected.length - tail.length) as never),
					normalizeTranscript(tail),
				),
			).toBe(true);
			console.log(
				`[transcript-paging] Codex largest ${(file.size / 1e6).toFixed(0)} MB: ${collected.length} messages in pages`,
			);
		}, 300_000);
	});
});
