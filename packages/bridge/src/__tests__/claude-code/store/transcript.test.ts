/**
 * Rules 6–7 and the transcript mapping (adapter README D26) over transcripts in a temp config dir, read by the SDK's
 * own reader.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { type TranscriptItem as Item, TranscriptItem } from "../../../contract";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { type BuiltTranscript, TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

interface Rich {
	readonly built: BuiltTranscript;
	readonly ids: {
		readonly prompt: string;
		readonly thinking: string;
		readonly lead: string;
		readonly call: string;
		readonly result: string;
		readonly answer: string;
		readonly second: string;
		readonly last: string;
	};
}

function rich(name = "rich"): Rich {
	const cwd = world.project(name);
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, cwd);
	const ids = {
		prompt: b.user("hello"),
		thinking: b.assistant("msg_1", { type: "thinking", thinking: "hmm" }),
		lead: b.text("msg_1", "let me look"),
		call: b.toolUse("msg_1", "toolu_1", "Read", { file_path: "/x" }),
		result: b.toolResult("toolu_1", "file data"),
		answer: b.text("msg_2", "done"),
		second: b.user("second"),
		last: b.text("msg_3", "ok"),
	};
	return { built: b.write(world.home.configDir), ids };
}

async function pages(sessionId: string, limit: number): Promise<Item[]> {
	const items: Item[] = [];
	let cursor: string | undefined;
	do {
		const result = await world.store.transcript(
			sessionId,
			{ limit, ...(cursor !== undefined && { cursor }) },
			world.live,
		);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		expect(result.page.items.length).toBeLessThanOrEqual(limit);
		expect(result.page.idStability).toBe("stable");
		items.push(...result.page.items);
		cursor = result.page.nextCursor;
	} while (cursor !== undefined);
	return items;
}

const shape = (items: readonly Item[]) => items.map((item) => `${item.kind}:${item.id}`);

describe("the transcript mapping", () => {
	test("maps each entry to its items, newest first, with the ids the live stream uses", async () => {
		const { built } = rich();
		const items = await pages(built.sessionId, 200);
		expect(items.every((item) => TranscriptItem.safeParse(item).success)).toBe(true);
		const [last, second, answer, result, call, lead, thinking, prompt] = items;
		expect(items).toHaveLength(8);
		expect(last).toMatchObject({ kind: "block", id: "msg_3:0", messageId: "msg_3", block: "text", text: "ok" });
		expect(second).toMatchObject({ kind: "user_message", text: "second", attachments: [] });
		expect(answer).toMatchObject({ kind: "block", id: "msg_2:0", text: "done" });
		expect(result).toMatchObject({ kind: "tool_result", id: "toolu_1:result", toolCallId: "toolu_1" });
		expect(call).toMatchObject({
			kind: "tool_call",
			id: "toolu_1",
			toolCallId: "toolu_1",
			name: "Read",
			messageId: "msg_1",
		});
		expect(call?.kind === "tool_call" && call.input).toEqual({ file_path: "/x" });
		expect(lead).toMatchObject({ kind: "block", id: "msg_1:1", block: "text", text: "let me look" });
		expect(thinking).toMatchObject({ kind: "block", id: "msg_1:0", block: "thinking", text: "hmm" });
		expect(prompt).toMatchObject({ kind: "user_message", id: built.uuids[0], text: "hello" });
		expect(prompt?.kind === "user_message" && prompt.clientRequestId).toBeUndefined();
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		expect(items.every((item) => item.at !== undefined)).toBe(true);
	});

	test("stamps each item with the time of its own line, so a turn's span is the first prompt's to the last answer's", async () => {
		const { built } = rich();
		const items = await pages(built.sessionId, 200);
		const oldestFirst = items.map((item) => item.at).reverse();
		const start = Date.UTC(2026, 10, 1);
		expect(oldestFirst).toEqual(Array.from({ length: 8 }, (_, line) => start + (line + 1) * 1000));
	});

	test("pages of one item concatenate to the same list as a single page", async () => {
		const { built } = rich();
		const whole = await pages(built.sessionId, 200);
		for (const limit of [1, 2, 3, 5]) expect(shape(await pages(built.sessionId, limit))).toEqual(shape(whole));
	});

	test("an assistant entry that holds several blocks splits across pages without losing or repeating one", async () => {
		const cwd = world.project("multi");
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, cwd);
		b.user("go");
		b.userBlocks([{ type: "text", text: "tail" }]);
		const uuid = crypto.randomUUID();
		const built = b.write(world.home.configDir);
		appendFileSync(
			built.path,
			`${JSON.stringify({
				type: "assistant",
				uuid,
				parentUuid: built.uuids.at(-1),
				sessionId,
				cwd,
				isSidechain: false,
				timestamp: "2026-11-02T00:00:00.000Z",
				message: {
					id: "msg_many",
					role: "assistant",
					content: [
						{ type: "text", text: "one" },
						{ type: "text", text: "two" },
						{ type: "tool_use", id: "toolu_many", name: "Bash", input: { command: "ls" } },
					],
				},
			})}\n`,
		);
		const whole = await pages(sessionId, 200);
		expect(shape(whole).slice(0, 3)).toEqual(["tool_call:toolu_many", "block:msg_many:1", "block:msg_many:0"]);
		for (const limit of [1, 2]) expect(shape(await pages(sessionId, limit))).toEqual(shape(whole));
	});

	test("a plain-string assistant content is one text block", async () => {
		const cwd = world.project("string");
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, cwd);
		b.user("hi");
		const built = b.write(world.home.configDir);
		appendFileSync(
			built.path,
			`${JSON.stringify({ type: "assistant", uuid: crypto.randomUUID(), parentUuid: built.uuids[0], sessionId, cwd, isSidechain: false, timestamp: "2026-11-02T00:00:00.000Z", message: { id: "msg_s", role: "assistant", content: "plain" } })}\n`,
		);
		expect(shape(await pages(sessionId, 10))[0]).toBe("block:msg_s:0");
	});

	test("a compaction shows as one item holding the summary, and what it replaced is gone", async () => {
		const cwd = world.project("compacted");
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, cwd);
		b.user("before");
		b.text("msg_a", "old answer");
		const summary = b.compaction("This session is being continued: the user said hello.");
		b.user("after");
		const built = b.write(world.home.configDir);
		const items = await pages(sessionId, 50);
		expect(items.map((item) => item.kind)).toEqual(["user_message", "compaction"]);
		expect(items[1]).toMatchObject({ id: summary, summary: "This session is being continued: the user said hello." });
		expect(built.uuids).toContain(summary);
	});

	test("the owner journal gives a prompt its clientRequestId, and only the prompts it recorded", async () => {
		const cwd = world.project("journal");
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, cwd);
		const sent = crypto.randomUUID();
		b.user("from the phone", sent);
		b.text("msg_j", "reply");
		b.user("from the terminal");
		b.write(world.home.configDir);
		await world.ownership.notePrompt(sessionId, sent, { imageNames: [] });
		const prompts = (await pages(sessionId, 10)).filter((item) => item.kind === "user_message");
		expect(prompts.map((item) => item.kind === "user_message" && item.clientRequestId)).toEqual([undefined, sent]);
		await world.restart();
		const again = (await pages(sessionId, 10)).filter((item) => item.kind === "user_message");
		expect(again.map((item) => item.kind === "user_message" && item.clientRequestId)).toEqual([undefined, sent]);
	});
});

describe("cut and cursors", () => {
	test("nothing after the cut shows; a null cut shows nothing; a cut the chain lost shows nothing", async () => {
		const { built, ids } = rich();
		world.live.rows.set(built.sessionId, { status: "running", cut: { lastUuidBefore: ids.answer } });
		expect((await pages(built.sessionId, 50))[0]).toMatchObject({ id: "msg_2:0" });
		expect(await pages(built.sessionId, 50)).toHaveLength(6);
		world.live.rows.set(built.sessionId, { status: "running", cut: { lastUuidBefore: null } });
		expect(await pages(built.sessionId, 50)).toEqual([]);
		world.live.rows.set(built.sessionId, { status: "running", cut: { lastUuidBefore: crypto.randomUUID() } });
		expect(await pages(built.sessionId, 50)).toEqual([]);
		world.live.rows.delete(built.sessionId);
		expect(await pages(built.sessionId, 50)).toHaveLength(8);
	});

	test("refuses a cursor it did not mint, one of another transcript, and one for an entry that is gone", async () => {
		const first = rich("c1");
		const second = rich("c2");
		const page = await world.store.transcript(first.built.sessionId, { limit: 2 }, world.live);
		if (page.status !== "accepted" || page.page.nextCursor === undefined) throw new Error("expected a cursor");
		const code = async (sessionId: string, cursor: string) => {
			const result = await world.store.transcript(sessionId, { limit: 2, cursor }, world.live);
			return result.status === "rejected" ? result.rejection.code : "accepted";
		};
		expect(await code(first.built.sessionId, "not-a-cursor")).toBe("invalid_input");
		expect(await code(second.built.sessionId, page.page.nextCursor)).toBe("invalid_input");
		const rewritten = new TranscriptBuilder(first.built.sessionId, first.built.cwd);
		rewritten.user("rewritten");
		rewritten.write(world.home.configDir);
		expect(await code(first.built.sessionId, page.page.nextCursor)).toBe("stale");
	});

	test("an unknown session is not_found", async () => {
		const result = await world.store.transcript(crypto.randomUUID(), { limit: 5 }, world.live);
		expect(result.status === "rejected" && result.rejection.code).toBe("not_found");
	});
});

describe("the index", () => {
	test("the first read takes the whole chain once; later pages read one window each, until the file changes", async () => {
		const { built } = rich();
		await world.store.transcript(built.sessionId, { limit: 2 }, world.live);
		expect(world.calls.messageReads).toEqual([{ offset: 0, limit: undefined }]);
		const second = await world.store.transcript(built.sessionId, { limit: 2 }, world.live);
		if (second.status !== "accepted" || second.page.nextCursor === undefined) throw new Error("expected a cursor");
		expect(world.calls.messageReads).toHaveLength(2);
		expect(world.calls.messageReads[1]?.limit).toBeDefined();
		await world.store.transcript(built.sessionId, { limit: 2, cursor: second.page.nextCursor }, world.live);
		expect(world.calls.messageReads.slice(2).every((read) => read.limit !== undefined)).toBe(true);
		const reads = world.calls.messageReads.length;
		appendFileSync(
			built.path,
			`${JSON.stringify({ type: "user", uuid: crypto.randomUUID(), parentUuid: built.uuids.at(-1), sessionId: built.sessionId, cwd: built.cwd, isSidechain: false, timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", content: "appended" } })}\n`,
		);
		const grown = await world.store.transcript(built.sessionId, { limit: 1 }, world.live);
		expect(grown.status === "accepted" && grown.page.items[0]).toMatchObject({
			kind: "user_message",
			text: "appended",
		});
		expect(world.calls.messageReads[reads]).toEqual({ offset: 0, limit: undefined });
	});

	test("lastChainUuid is the newest entry, null for no transcript, and invalidate forgets the index", async () => {
		const { built, ids } = rich();
		expect(await world.store.lastChainUuid(built.sessionId)).toBe(ids.last);
		expect(await world.store.lastChainUuid(crypto.randomUUID())).toBeNull();
		await world.store.transcript(built.sessionId, { limit: 1 }, world.live);
		const before = world.calls.messageReads.length;
		world.store.invalidate(built.sessionId);
		await world.store.transcript(built.sessionId, { limit: 1 }, world.live);
		expect(world.calls.messageReads[before]).toEqual({ offset: 0, limit: undefined });
	});
});
