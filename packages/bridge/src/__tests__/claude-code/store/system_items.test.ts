/** D41a: `system` entries the SDK's chain holds become run boundaries and notices; a compaction learns its numbers. */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { type TranscriptItem, TranscriptItem as TranscriptItemSchema } from "../../../contract";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

async function pages(sessionId: string, limit: number): Promise<TranscriptItem[]> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await world.store.transcript(
			sessionId,
			{ limit, ...(cursor !== undefined && { cursor }) },
			world.live,
		);
		if (page.status !== "accepted") throw new Error(page.rejection.message);
		items.push(...page.page.items);
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return items;
}

test("turn_duration is a completed run boundary; informational, local_command and away_summary are notices", async () => {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project("system"));
	b.user("go");
	b.text("msg_1", "done");
	const turn = b.system("turn_duration", { durationMs: 1200 });
	b.system("informational", { content: "Heads up", level: "warning" });
	b.system("local_command", { content: "<local-command-stdout>## Context\n3k / 1m</local-command-stdout>" });
	b.system("away_summary", { content: "You were building the store." });
	b.system("api_error", { content: "an unknown subtype shows nothing" });
	b.user("next");
	b.text("msg_2", "ok");
	b.system("turn_duration", { durationMs: 5 });
	b.write(world.home.configDir);
	const items = await pages(sessionId, 200);
	expect(items.every((item) => TranscriptItemSchema.safeParse(item).success)).toBe(true);
	expect(items.map((item) => item.kind)).toEqual([
		"block",
		"user_message",
		"notice",
		"notice",
		"notice",
		"run_boundary",
		"block",
		"user_message",
	]);
	expect(items[2]).toMatchObject({ kind: "notice", level: "info", text: "You were building the store." });
	expect(items[3]).toMatchObject({ kind: "notice", level: "info", text: "## Context\n3k / 1m" });
	expect(items[4]).toMatchObject({ kind: "notice", level: "warning", text: "Heads up" });
	expect(items[5]).toMatchObject({ kind: "run_boundary", id: turn, outcome: { kind: "completed" } });
	expect((await pages(sessionId, 1)).map((item) => item.id)).toEqual(items.map((item) => item.id));
});

test("a compaction carries the boundary's trigger and token counts", async () => {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project("compaction-numbers"));
	b.user("before");
	b.text("msg_a", "old");
	b.compaction("The summary.");
	b.user("after");
	b.write(world.home.configDir);
	const items = await pages(sessionId, 50);
	expect(items.find((item) => item.kind === "compaction")).toMatchObject({
		summary: "The summary.",
		trigger: "manual",
		tokensBefore: 100,
		tokensAfter: 10,
	});
});

test("a system entry after the last prompt or answer is not in the SDK's chain, so it shows once something follows it", async () => {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project("trailing"));
	b.user("go");
	b.text("msg_1", "done");
	b.system("turn_duration", { durationMs: 1 });
	b.write(world.home.configDir);
	expect((await pages(sessionId, 50)).map((item) => item.kind)).toEqual(["block", "user_message"]);
	expect(await world.store.lastChainUuid(sessionId)).toBe(b.uuids[1] ?? "");
});

test("a run in progress hides the notices and boundaries after the cut as it hides everything else", async () => {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project("cut-system"));
	b.user("go");
	const answer = b.text("msg_1", "done");
	b.system("turn_duration", { durationMs: 1 });
	b.user("second");
	b.write(world.home.configDir);
	world.live.rows.set(sessionId, { status: "running", cut: { lastUuidBefore: answer } });
	expect((await pages(sessionId, 50)).map((item) => item.kind)).toEqual(["block", "user_message"]);
	world.live.rows.set(sessionId, { status: "idle" });
	expect((await pages(sessionId, 50)).map((item) => item.kind)).toEqual([
		"user_message",
		"run_boundary",
		"block",
		"user_message",
	]);
});

test("a fork before an item that follows a system entry, and through a run boundary, are accepted by the SDK", async () => {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project("fork-system"));
	b.user("go");
	b.text("msg_1", "done");
	const turn = b.system("turn_duration", { durationMs: 1 });
	const second = b.user("second");
	b.text("msg_2", "ok");
	b.write(world.home.configDir);
	const before = await world.store.fork(sessionId, { itemId: second, position: "before" }, world.live);
	const through = await world.store.fork(sessionId, { itemId: turn, position: "through" }, world.live);
	expect(before.status === "rejected" ? before.rejection.message : before.status).toBe("accepted");
	expect(through.status === "rejected" ? through.rejection.message : through.status).toBe("accepted");
	if (before.status === "accepted")
		expect((await pages(before.session.sessionId, 50)).map((item) => item.kind)).toEqual(["block", "user_message"]);
});
