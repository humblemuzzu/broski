/**
 * On the real adapter: transcript paging that holds still while a file grows, cursors
 * from anywhere else refused, and files as a terminal `pi` or an older Pi leaves them: very large,
 * with U+2028 in the text, a parent cycle, version 1 and 2, a half-written last line.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionRef, TranscriptItem } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { userItems } from "./helpers/live-steps";
import { allItems, allRows } from "./helpers/paging";
import { runProbe } from "./helpers/probe";
import { conversation, messageEntry, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const ids = (items: readonly TranscriptItem[]) => items.map((item) => item.id);

function external(rig: LiveRig, id: string, entries: readonly object[], version: 1 | 2 | 3 = 3): SessionRef {
	writeSessionFile(rig.world.sessionsRoot, { id, cwd: rig.cwd, ...(version !== 1 && { version }) }, entries);
	return { backend: "pi", sessionId: id };
}

async function page(rig: LiveRig, ref: SessionRef, request: { limit: number; cursor?: string }) {
	const read = await rig.backend.readTranscript(ref, request);
	if (read.status === "rejected") throw new Error(`readTranscript: ${read.rejection.code} ${read.rejection.message}`);
	return read.page;
}

async function threeRuns(rig: LiveRig) {
	const live = await rig.rig.openNew();
	for (const text of ["one", "two", "three"]) {
		await rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run(text);
	}
	return live;
}

describe("cursors", () => {
	test("hold still while the file grows: the next page continues exactly where the first ended", async () => {
		t = await LiveRig.create();
		const live = await threeRuns(t);
		const before = ids(await allItems(t.backend, live.ref, 200));
		const first = await page(t, live.ref, { limit: 3 });
		expect(ids(first.items)).toEqual(before.slice(0, 3));
		const cursor = first.nextCursor;
		if (cursor === undefined) throw new Error("the first page has no next page");

		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("four");
		const grown = ids(await allItems(t.backend, live.ref, 200));
		expect(grown.length).toBeGreaterThan(before.length);

		const rest = ids(await allItems(t.backend, live.ref, 3, cursor));
		expect(rest).toEqual(before.slice(3));
		expect(first.idStability).toBe("stable");
	});

	test("from another session, another query, another read or a tampered string are invalid_input, never the newest page", async () => {
		t = await LiveRig.create();
		const live = await threeRuns(t);
		const other = await threeRuns(t);
		const first = await page(t, live.ref, { limit: 2 });
		const cursor = first.nextCursor ?? "";
		expect(cursor).not.toBe("");

		const listing = await t.backend.listSessions({ cwd: t.cwd }, { limit: 1 });
		const listCursor = listing.status === "accepted" ? (listing.page.nextCursor ?? "") : "";
		expect(listCursor).not.toBe("");
		const forged = Buffer.from(
			JSON.stringify({ v: 1, k: "transcript", s: "somewhere-else", p: { b: 1, a: "x" } }),
		).toString("base64url");
		const bad = [
			await t.backend.readTranscript(other.ref, { limit: 2, cursor }),
			await t.backend.readTranscript(live.ref, { limit: 2, cursor: listCursor }),
			await t.backend.listSessions({ cwd: t.cwd }, { limit: 1, cursor }),
			await t.backend.listSessions({ cwd: t.world.env.otherCwd }, { limit: 1, cursor: listCursor }),
			await t.backend.readTranscript(live.ref, { limit: 2, cursor: `~${cursor.slice(1)}` }),
			await t.backend.readTranscript(live.ref, { limit: 2, cursor: forged }),
		];
		for (const result of bad)
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
	});
});

describe("files as Pi and older versions leave them", () => {
	test("a 40 MB file pages from its newest end, correctly", async () => {
		t = await LiveRig.create();
		const turns = Array.from({ length: 400 }, (_, index) => `${index}:${"x".repeat(100_000)}`);
		const ref = external(t, "forty-megabytes", conversation(turns));

		const began = performance.now();
		const first = await page(t, ref, { limit: 20 });
		const elapsed = performance.now() - began;
		expect(first.items).toHaveLength(20);
		const texts = first.items.map((item) => ("text" in item ? item.text.slice(0, 4) : ""));
		expect(texts[0]).toBe("399:");
		expect(texts[19]).toBe("380:");
		expect(elapsed).toBeLessThan(5_000);
		const second = await page(t, ref, { limit: 20, cursor: first.nextCursor });
		const next = second.items[0];
		expect(next && "text" in next && next.text.startsWith("379:")).toBe(true);
	}, 30_000);

	test("U+2028 and U+2029 inside text are text, not line ends", async () => {
		t = await LiveRig.create();
		const ref = external(t, "line-separators", conversation(["before\u2028after", "answer\u2029more", "tail\u2028"]));
		const items = await allItems(t.backend, ref, 200);
		expect(items.map((item) => ("text" in item ? item.text : ""))).toEqual([
			"tail\u2028",
			"answer\u2029more",
			"before\u2028after",
		]);
		const rows = await allRows(t.backend, { cwd: t.cwd }, 50);
		expect(rows.some((row) => row.session.sessionId === ref.sessionId)).toBe(true);
	});

	test("a parent cycle and a self-parent end the read instead of looping (run in a child with a clock)", async () => {
		const script = join(import.meta.dir, "helpers", "probe-cycle.ts");
		const result = await runProbe([script]);
		if (result.status !== "done")
			throw new Error(`the adapter did not finish reading a parent cycle: ${JSON.stringify(result)}`);
		const answer: { transcript: string[] | string; session: string; listed: string[] | string } = JSON.parse(
			result.output,
		);
		expect(Array.isArray(answer.transcript) && answer.transcript.length).toBeLessThanOrEqual(3);
		expect(new Set(answer.transcript).size).toBe(Array.isArray(answer.transcript) ? answer.transcript.length : 1);
		expect(answer.session).toBe("accepted");
		expect(answer.listed).toEqual(["parent-cycle"]);
	}, 30_000);

	test.each([
		{ name: "version 1", version: 1, stability: "positional" },
		{ name: "version 2", version: 2, stability: "stable" },
		{ name: "version 3", version: 3, stability: "stable" },
	] as const)(
		"$name is read in memory: its conversation comes back, the file is untouched",
		async ({ name, version, stability }) => {
			t = await LiveRig.create();
			const entries =
				version === 1
					? [
							messageEntry(undefined, undefined, "user", "hello"),
							messageEntry(undefined, undefined, "assistant", "hi there"),
						]
					: conversation(["hello", "hi there"]);
			const id = `old-${name.replace(" ", "-")}`;
			const ref = external(t, id, entries, version);
			const file = t.fileOf(ref);
			const before = { bytes: readFileSync(file), modified: statSync(file).mtimeMs };

			const read = await page(t, ref, { limit: 50 });
			expect(read.idStability).toBe(stability);
			expect(read.items.map((item) => ("text" in item ? item.text : ""))).toEqual(["hi there", "hello"]);
			await allRows(t.backend, { cwd: t.cwd }, 50);
			const opened = await t.rig.open(ref);
			await opened.close();

			expect(readFileSync(file).equals(before.bytes)).toBe(true);
			expect(statSync(file).mtimeMs).toBe(before.modified);
		},
	);

	test("entries Pi would skip are skipped: unknown types, null content, and a last line still being written", async () => {
		t = await LiveRig.create();
		const entries = [
			...conversation(["hello", "hi there"]),
			{ type: "context_edit", id: "e3", parentId: "e2", timestamp: "2026-01-01T00:00:01.000Z", targetId: "e2" },
			{ type: "future_thing", id: "e4", parentId: "e3", timestamp: "2026-01-01T00:00:02.000Z" },
			{
				type: "message",
				id: "e5",
				parentId: "e4",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: { role: "user", content: null, timestamp: 1 },
			},
		];
		const ref = external(t, "odd-entries", entries);
		appendFileSync(t.fileOf(ref), '{"type":"message","id":"e6","parentId":"e5","timest');

		const items = await allItems(t.backend, ref, 200);
		expect(userItems(items).map((item) => item.text)).toEqual(["", "hello"]);
		expect(items.some((item) => item.kind === "block" && item.text === "hi there")).toBe(true);
	});
});
