/** Rule 8 for the store: rename, fork and delete show in the catalog, claim in the journal, and survive a restart. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionSummary, type TranscriptItem } from "../../../contract";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

function session(name = "mut") {
	const cwd = world.project(name);
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, cwd);
	const ids = {
		first: b.user("first prompt"),
		call: b.toolUse("msg_1", "toolu_1", "Read", { file_path: "/x" }),
		result: b.toolResult("toolu_1", "data"),
		answer: b.text("msg_2", "answer one"),
		second: b.user("second prompt"),
		last: b.text("msg_3", "answer two"),
	};
	return { built: b.write(world.home.configDir), ids, cwd };
}

async function texts(sessionId: string): Promise<(string | undefined)[]> {
	const page = await world.store.transcript(sessionId, { limit: 200 }, world.live);
	if (page.status !== "accepted") throw new Error("rejected");
	return page.page.items.map((item: TranscriptItem) =>
		item.kind === "user_message" || item.kind === "block" ? item.text : item.kind,
	);
}

describe("rename", () => {
	test("renames through the SDK, emits session_updated with a user title, and the row shows it", async () => {
		const { built } = session();
		world.live.rows.set(built.sessionId, { status: "running" });
		expect((await world.store.rename(built.sessionId, "  A better name ", world.live)).status).toBe("accepted");
		const update = world.events.find((event) => event.type === "session_updated");
		expect(update?.type === "session_updated" && update.summary.title).toEqual({
			text: "A better name",
			source: "user",
		});
		expect(update?.type === "session_updated" && update.summary.status).toBe("running");
		world.live.rows.delete(built.sessionId);
		const found = await world.store.get(built.sessionId, world.live);
		expect(found.status === "accepted" && found.summary.title?.text).toBe("A better name");
	});

	test("refuses an empty title and an unknown session", async () => {
		const { built } = session();
		const empty = await world.store.rename(built.sessionId, "   ", world.live);
		const unknown = await world.store.rename(crypto.randomUUID(), "x", world.live);
		expect(empty.status === "rejected" && empty.rejection.code).toBe("invalid_input");
		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
	});
});

describe("fork", () => {
	test("forks the whole history, claims the fork, links it to its source and announces it", async () => {
		const { built } = session();
		const forked = await world.store.fork(built.sessionId, undefined, world.live);
		if (forked.status !== "accepted") throw new Error(forked.rejection.message);
		const id = forked.session.sessionId;
		expect(id).not.toBe(built.sessionId);
		expect(await texts(id)).toEqual(await texts(built.sessionId));
		expect(world.ownership.origin(id)).toBe("broski");
		const update = world.events.find(
			(event) => event.type === "session_updated" && event.summary.session.sessionId === id,
		);
		expect(update?.type === "session_updated" && SessionSummary.safeParse(update.summary).success).toBe(true);
		expect(update?.type === "session_updated" && update.summary.parent).toEqual({
			kind: "fork",
			session: { backend: "claude-code", sessionId: built.sessionId },
		});
		await world.restart();
		const found = await world.store.get(id, world.live);
		expect(found.status === "accepted" && found.summary.parent?.session.sessionId).toBe(built.sessionId);
		expect(found.status === "accepted" && found.summary.origin).toBe("broski");
	});

	test("forks through an item, and before one", async () => {
		const { built, ids } = session();
		const through = await world.store.fork(built.sessionId, { itemId: ids.answer, position: "through" }, world.live);
		const before = await world.store.fork(built.sessionId, { itemId: ids.second, position: "before" }, world.live);
		if (through.status !== "accepted" || before.status !== "accepted") throw new Error("rejected");
		expect(await texts(through.session.sessionId)).toEqual(["answer one", "tool_result", "tool_call", "first prompt"]);
		expect(await texts(before.session.sessionId)).toEqual(await texts(through.session.sessionId));
	});

	test("forking through a tool call keeps its result", async () => {
		const { built } = session();
		const forked = await world.store.fork(built.sessionId, { itemId: "toolu_1", position: "through" }, world.live);
		if (forked.status !== "accepted") throw new Error("rejected");
		expect(await texts(forked.session.sessionId)).toEqual(["tool_result", "tool_call", "first prompt"]);
	});

	test("forks only what a running session has finished, and refuses what comes before the first item", async () => {
		const { built, ids } = session();
		world.live.rows.set(built.sessionId, { status: "running", cut: { lastUuidBefore: ids.answer } });
		const finished = await world.store.fork(built.sessionId, undefined, world.live);
		if (finished.status !== "accepted") throw new Error("rejected");
		expect(await texts(finished.session.sessionId)).toEqual(["answer one", "tool_result", "tool_call", "first prompt"]);
		const inside = await world.store.fork(built.sessionId, { itemId: ids.last, position: "through" }, world.live);
		expect(inside.status === "rejected" && inside.rejection.code).toBe("invalid_input");
		world.live.rows.delete(built.sessionId);
		const nothing = await world.store.fork(built.sessionId, { itemId: ids.first, position: "before" }, world.live);
		expect(nothing.status === "rejected" && nothing.rejection.code).toBe("invalid_input");
		const unknownItem = await world.store.fork(built.sessionId, { itemId: "msg_9:0", position: "through" }, world.live);
		expect(unknownItem.status === "rejected" && unknownItem.rejection.code).toBe("not_found");
		const unknownSession = await world.store.fork(crypto.randomUUID(), undefined, world.live);
		expect(unknownSession.status === "rejected" && unknownSession.rejection.code).toBe("not_found");
	});
});

describe("delete", () => {
	test("moves the transcript and the session directory to the trash under HOME, and emits session_removed", async () => {
		const { built } = session();
		const directory = built.path.slice(0, -".jsonl".length);
		mkdirSync(join(directory, "subagents"), { recursive: true });
		writeFileSync(join(directory, "custom-title.json"), "{}");
		expect((await world.store.remove(built.sessionId)).status).toBe("accepted");
		expect(existsSync(built.path)).toBe(false);
		expect(existsSync(directory)).toBe(false);
		const trash = join(world.home.homeDir, ".Trash");
		expect(readdirSync(trash).sort()).toEqual([built.sessionId, `${built.sessionId}.jsonl`].sort());
		expect(readFileSync(join(trash, `${built.sessionId}.jsonl`), "utf8")).toContain("first prompt");
		expect(world.events.find((event) => event.type === "session_removed")).toEqual({
			type: "session_removed",
			session: { backend: "claude-code", sessionId: built.sessionId },
		});
		const gone = await world.store.get(built.sessionId, world.live);
		expect(gone.status === "rejected" && gone.rejection.code).toBe("not_found");
		const list = await world.store.list({ cwd: built.cwd, archived: false }, { limit: 10 }, world.live);
		expect(list.status === "accepted" && list.page.items).toEqual([]);
	});

	test("an unknown session is not_found and nothing is trashed; a name already in the trash is kept", async () => {
		const { built } = session();
		const unknown = await world.store.remove(crypto.randomUUID());
		expect(unknown.status === "rejected" && unknown.rejection.code).toBe("not_found");
		const trash = join(world.home.homeDir, ".Trash");
		mkdirSync(trash, { recursive: true });
		writeFileSync(join(trash, `${built.sessionId}.jsonl`), "an older file");
		expect((await world.store.remove(built.sessionId)).status).toBe("accepted");
		expect(readFileSync(join(trash, `${built.sessionId}.jsonl`), "utf8")).toBe("an older file");
		expect(readdirSync(trash)).toContain(`${built.sessionId} 2.jsonl`);
	});
});
