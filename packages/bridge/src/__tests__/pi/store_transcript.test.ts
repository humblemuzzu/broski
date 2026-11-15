/**
 * `readTranscript` over session files, with the entry mapping a stub that implements the
 * frozen `itemsOfEntry` interface (store_fixtures.ts); the real mapping is exercised in store_facade.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { cursorScope, encodeCursor } from "../../backends/pi/cursor";
import type { LiveOverlay } from "../../backends/pi/ports";
import type { ItemsOfEntry } from "../../backends/pi/store/branch-items";
import { piSessionDirs } from "../../backends/pi/store/session-dir";
import { SessionIndex } from "../../backends/pi/store/session-index";
import { readTranscript } from "../../backends/pi/store/transcript";
import { type PageRequest, type TranscriptItem, TranscriptReadResult } from "../../contract";
import { createPiTestEnv, type PiTestEnv } from "./helpers/pi-test-env";
import { itemsOfEntryStub, SessionBuilder, textBlock, thinkingBlock, toolCall, writeSession } from "./store_fixtures";

let env: PiTestEnv;
let index: SessionIndex;
let mapped: number;

const NOBODY: LiveOverlay = { row: () => undefined };

const counting: ItemsOfEntry = (entry, context) => {
	mapped += 1;
	return itemsOfEntryStub(entry, context);
};

beforeEach(() => {
	env = createPiTestEnv();
	index = new SessionIndex(piSessionDirs(env.agentDir));
	mapped = 0;
});

afterEach(() => {
	env.dispose();
});

async function page(id: string, request: PageRequest, live: LiveOverlay = NOBODY, itemsOf: ItemsOfEntry = counting) {
	const result = await readTranscript(index, id, request, live, itemsOf);
	expect(TranscriptReadResult.safeParse(result).success).toBe(true);
	return result;
}

async function everything(id: string, limit: number, live: LiveOverlay = NOBODY): Promise<TranscriptItem[]> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	do {
		const result = await page(id, { limit, ...(cursor !== undefined && { cursor }) }, live);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		expect(result.page.items.length).toBeLessThanOrEqual(limit);
		items.push(...result.page.items);
		cursor = result.page.nextCursor;
	} while (cursor !== undefined);
	return items;
}

/** user, assistant(thinking, text, call c1, call c2), result c1, result c2, assistant(text). */
function toolSession(id = "tools", version: 1 | 2 | 3 = 3): SessionBuilder {
	const builder = new SessionBuilder({ id, cwd: env.cwd, ...(version !== 1 && { version }) });
	builder.user("look at the README", 100);
	builder.assistant(
		[thinkingBlock("hm"), textBlock("reading"), toolCall("c1"), toolCall("c2", "read", { path: "x" })],
		200,
	);
	builder.toolResult("c1", "first", 300);
	builder.toolResult("c2", "second", 400);
	builder.assistant([textBlock("done")], 500);
	return builder;
}

const kinds = (items: readonly TranscriptItem[]) => items.map((item) => item.kind);

describe("reading a transcript", () => {
	test("items come newest first, one per block, call and result", async () => {
		writeSession(env.sessionDir, toolSession());

		const result = await page("tools", { limit: 200 });
		if (result.status === "rejected") throw new Error("rejected");

		expect(result.page.idStability).toBe("stable");
		expect(result.page.nextCursor).toBeUndefined();
		expect(result.page.items.map((item) => item.id)).toEqual([
			"e0000005:0",
			"e0000004:0",
			"e0000003:0",
			"e0000002:3",
			"e0000002:2",
			"e0000002:1",
			"e0000002:0",
			"e0000001:0",
		]);
	});

	test("pages of every size concatenate to the one-page read, and a page boundary may fall inside a message", async () => {
		writeSession(env.sessionDir, toolSession());
		const whole = await everything("tools", 200);

		for (const limit of [1, 2, 3, 5, 7]) {
			expect((await everything("tools", limit)).map((item) => item.id)).toEqual(whole.map((item) => item.id));
		}
		expect(whole).toHaveLength(8);
	});

	test("a result is paired with the call of the nearest assistant message, also when that message is on another page", async () => {
		const builder = new SessionBuilder({ id: "repeat", cwd: env.cwd, version: 3 });
		builder.user("go", 10);
		builder.assistant([toolCall("call_1")], 20);
		builder.toolResult("call_1", "one", 30);
		builder.assistant([toolCall("call_1")], 40);
		builder.toolResult("call_1", "two", 50);
		writeSession(env.sessionDir, builder);

		for (const limit of [1, 2, 100]) {
			const items = await everything("repeat", limit);
			const calls = items.filter((item) => item.kind === "tool_call");
			const results = items.filter((item) => item.kind === "tool_result");
			expect(calls.map((call) => call.toolCallId)).toEqual(["e0000004:0", "e0000002:0"]);
			expect(results.map((result) => result.toolCallId)).toEqual(["e0000004:0", "e0000002:0"]);
			expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		}
	});

	test("a call with no result, as a crash leaves it, shows the call alone; a result with no call stands alone", async () => {
		const builder = new SessionBuilder({ id: "crash", cwd: env.cwd, version: 3 });
		builder.user("go", 10);
		builder.assistant([toolCall("lost")], 20);
		builder.toolResult("no-such-call", "orphan", 30);
		writeSession(env.sessionDir, builder);

		const items = await everything("crash", 10);

		expect(kinds(items)).toEqual(["tool_result", "tool_call", "user_message"]);
		expect(items[0]?.kind === "tool_result" && items[0].toolCallId).toBe("e0000003:0");
	});

	test("the prompt record that names a user message gives it its clientRequestId", async () => {
		const builder = new SessionBuilder({ id: "prompted", cwd: env.cwd, version: 3 });
		const entryId = builder.user("hello", 10);
		const clientRequestId = "6f1b2f6e-7f3a-4c52-9c11-0a1b2c3d4e5f";
		builder.custom("broski.prompt", { entryId, clientRequestId, imageNames: [] }, 11);
		builder.assistant([textBlock("hi")], 20);
		writeSession(env.sessionDir, builder);

		const items = await everything("prompted", 10);

		const user = items.find((item) => item.kind === "user_message");
		expect(user?.kind === "user_message" && user.clientRequestId).toBe("6f1b2f6e-7f3a-4c52-9c11-0a1b2c3d4e5f");
	});

	test("only the branch the file ends on is shown, and a compaction on it does not stop the paging", async () => {
		const builder = new SessionBuilder({ id: "branchy", cwd: env.cwd, version: 3 });
		const first = builder.user("one", 10);
		const answer = builder.assistant([textBlock("a")], 20);
		builder.user("abandoned", 30);
		builder.branchFrom(answer);
		builder.compaction("summary", first, 35);
		builder.user("kept", 40);
		writeSession(env.sessionDir, builder);

		const items = await everything("branchy", 2);

		expect(kinds(items)).toEqual(["user_message", "compaction", "block", "user_message"]);
	});

	test("a v2 file reads with its own ids as stable, a v1 file with positional ones", async () => {
		writeSession(env.sessionDir, toolSession("v2", 2));
		writeSession(env.sessionDir, toolSession("v1", 1));

		const v2 = await page("v2", { limit: 200 });
		const v1 = await page("v1", { limit: 200 });

		expect(v2.status === "accepted" && v2.page.idStability).toBe("stable");
		expect(v1.status === "accepted" && v1.page.idStability).toBe("positional");
		expect(v1.status === "accepted" && v1.page.items.map((item) => item.id)).toEqual([
			"l5:0",
			"l4:0",
			"l3:0",
			"l2:3",
			"l2:2",
			"l2:1",
			"l2:0",
			"l1:0",
		]);
		const results = v1.status === "accepted" ? v1.page.items.filter((item) => item.kind === "tool_result") : [];
		expect(results.map((item) => item.kind === "tool_result" && item.toolCallId)).toEqual(["l2:3", "l2:2"]);
	});

	test("U+2028 in a message does not change the items", async () => {
		const builder = new SessionBuilder({ id: "sep", cwd: env.cwd, version: 3 });
		builder.user("a\u2028b", 10);
		builder.assistant([textBlock("c\u2029d")], 20);
		writeSession(env.sessionDir, builder);

		const items = await everything("sep", 10);

		expect(items.map((item) => (item.kind === "block" || item.kind === "user_message" ? item.text : ""))).toEqual([
			"c\u2029d",
			"a\u2028b",
		]);
	});
});

describe("the cursor of a transcript", () => {
	test("a cursor that is not this transcript's is invalid_input, never the newest page", async () => {
		writeSession(env.sessionDir, toolSession("one"));
		writeSession(env.sessionDir, toolSession("two"));
		const first = await page("one", { limit: 2 });
		const minted = first.status === "accepted" ? (first.page.nextCursor ?? "") : "";
		const scope = cursorScope(["transcript", "one"]);
		const refused = [
			"not-a-cursor",
			minted.slice(0, -2),
			encodeCursor("transcript", scope, { e: 99, j: 0, a: "e0000002:0" }),
			encodeCursor("transcript", scope, { e: 1, j: 0, a: "e0000009:0" }),
			encodeCursor("transcript", scope, { e: 1, j: 99, a: "e0000002:0" }),
			encodeCursor("transcript", scope, { e: -1, j: 0, a: "x" }),
			encodeCursor("transcript", scope, [1, "x"]),
			encodeCursor("sessions", scope, [1, "x"]),
		];

		for (const cursor of refused) {
			const result = await page("one", { limit: 2, cursor });
			expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
		const other = await page("two", { limit: 2, cursor: minted });
		expect(other.status === "rejected" && other.rejection.code).toBe("invalid_input");
		const fine = await page("one", { limit: 2, cursor: minted });
		expect(fine.status).toBe("accepted");
	});

	test("a cursor whose item is no longer where it was is refused", async () => {
		const builder = toolSession("edited");
		const path = writeSession(env.sessionDir, builder);
		const first = await page("edited", { limit: 2 });
		const cursor = first.status === "accepted" ? (first.page.nextCursor ?? "") : "";
		writeFileSync(path, readFileSync(path, "utf8").replaceAll("e0000003", "f0000003"));

		const result = await page("edited", { limit: 2, cursor });

		expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
	});

	test("a file that grows between pages keeps the cursor valid and the pages whole", async () => {
		const builder = toolSession("growing");
		const path = writeSession(env.sessionDir, builder);
		const before = await everything("growing", 200);
		const first = await page("growing", { limit: 3 });
		if (first.status === "rejected") throw new Error("rejected");

		builder.user("one more", 600);
		builder.assistant([textBlock("and more")], 700);
		appendFileSync(
			path,
			builder.lines
				.slice(-2)
				.map((line) => `${JSON.stringify(line)}\n`)
				.join(""),
		);
		const second = await page("growing", { limit: 100, cursor: first.page.nextCursor });
		if (second.status === "rejected") throw new Error("rejected");

		expect([...first.page.items, ...second.page.items].map((item) => item.id)).toEqual(before.map((item) => item.id));
		const fresh = await everything("growing", 200);
		expect(fresh.slice(2).map((item) => item.id)).toEqual(before.map((item) => item.id));
		expect(fresh).toHaveLength(before.length + 2);
	});

	test("an entry another process is still writing is not read", async () => {
		const builder = toolSession("torn");
		const path = writeSession(env.sessionDir, builder);
		appendFileSync(
			path,
			`{"type":"message","id":"e0000006","parentId":"e0000005","timestamp":"2026-03-01T10:00:00.000Z","mess`,
		);

		expect(await everything("torn", 200)).toHaveLength(8);

		appendFileSync(path, `age":{"role":"user","content":"late","timestamp":1}}\n`);
		expect(await everything("torn", 200)).toHaveLength(9);
	});
});

describe("what the transcript ends at", () => {
	test("while a run is active it ends at the entry the run started after", async () => {
		writeSession(env.sessionDir, toolSession());
		const cut = (leafEntryId: string | null): LiveOverlay => ({
			row: () => ({ status: "running", cut: { leafEntryId } }),
		});

		expect(kinds(await everything("tools", 50, cut("e0000002")))).toEqual([
			"tool_call",
			"tool_call",
			"block",
			"block",
			"user_message",
		]);
		expect(await everything("tools", 50, cut(null))).toEqual([]);
		const missing = await page("tools", { limit: 5 }, cut("e9999999"));
		expect(missing.status === "rejected" && missing.rejection.code).toBe("backend_error");
	});

	test("an unknown session is not_found", async () => {
		const unknown = await page("nobody", { limit: 10 });

		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
	});
});

describe("a big session", () => {
	test("40 MB: the first page maps only the entries it shows, and a deep page is as cheap", async () => {
		const builder = new SessionBuilder({ id: "big", cwd: env.cwd, version: 3 });
		const padding = "x".repeat(100_000);
		for (let turn = 0; turn < 400; turn += 1) {
			builder.user(`question ${turn}`, turn * 10);
			builder.assistant([textBlock(padding)], turn * 10 + 1);
		}
		const path = writeSession(env.sessionDir, builder);
		expect(statSync(path).size).toBeGreaterThan(40_000_000);

		const started = performance.now();
		const first = await page("big", { limit: 10 });
		const firstMs = performance.now() - started;
		if (first.status === "rejected") throw new Error("rejected");
		const mappedForFirst = mapped;
		const deepStarted = performance.now();
		const deep = await page("big", { limit: 10, cursor: first.page.nextCursor });
		const deepMs = performance.now() - deepStarted;

		expect(first.page.items).toHaveLength(10);
		expect(mappedForFirst).toBeLessThanOrEqual(12);
		expect(deep.status).toBe("accepted");
		expect(firstMs).toBeLessThan(2_000);
		expect(deepMs).toBeLessThan(2_000);
	});
});
