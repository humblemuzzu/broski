/** Rule 5 and its neighbours against transcripts in a temp config dir: keyset pages, scoping, rows, cost. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { type SessionQuery, SessionSummary, type SessionSummary as Summary } from "../../../contract";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

function seed(cwd: string, prompt: string, at: Date, sessionId: string = crypto.randomUUID()): string {
	const builder = new TranscriptBuilder(sessionId, cwd);
	builder.user(prompt);
	builder.text(`msg_${sessionId.slice(0, 8)}`, `Answer to ${prompt}`);
	const { path } = builder.write(world.home.configDir);
	utimesSync(path, at, at);
	return sessionId;
}

async function everyPage(query: SessionQuery, limit: number): Promise<Summary[]> {
	const rows: Summary[] = [];
	let cursor: string | undefined;
	do {
		const result = await world.store.list(query, { limit, ...(cursor !== undefined && { cursor }) }, world.live);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		expect(result.page.items.length).toBeLessThanOrEqual(limit);
		rows.push(...result.page.items);
		cursor = result.page.nextCursor;
	} while (cursor !== undefined);
	return rows;
}

describe("listing", () => {
	test("pages concatenate newest first inside the requested cwd, equal to one listing", async () => {
		const here = world.project("here");
		const there = world.project("there");
		for (let n = 0; n < 7; n++) seed(here, `prompt ${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		for (let n = 0; n < 3; n++) seed(there, `other ${n}`, new Date(Date.UTC(2026, 0, 20 + n)));
		const query = { cwd: here, archived: false };
		const paged = await everyPage(query, 2);
		const whole = await everyPage(query, 200);
		const ids = paged.map((row) => row.session.sessionId);
		expect(paged).toHaveLength(7);
		expect(new Set(ids).size).toBe(7);
		expect(ids).toEqual(whole.map((row) => row.session.sessionId));
		const times = paged.map((row) => row.updatedAt);
		expect(times).toEqual([...times].sort((a, b) => b - a));
		expect(paged.every((row) => row.cwd === here && SessionSummary.safeParse(row).success)).toBe(true);
		expect((await everyPage({ cwd: there, archived: false }, 2)).length).toBe(3);
	});

	test("breaks a lastModified tie by sessionId descending, as listSessions does, on every page", async () => {
		const cwd = world.project("ties");
		const tied = new Date(Date.UTC(2026, 0, 1));
		const ids = ["1", "3", "2", "0", "4"].map(
			(d) => `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`,
		);
		for (const id of ids) seed(cwd, "tie", tied, id);
		const sdkOrder = (await world.sdk.listSessions({ dir: cwd, includeWorktrees: false })).map((row) => row.sessionId);
		for (const limit of [1, 2, 3, 200]) {
			const ours = (await everyPage({ cwd, archived: false }, limit)).map((row) => row.session.sessionId);
			expect(ours).toEqual(sdkOrder);
		}
		expect(sdkOrder[0]).toBe(ids[4]);
	});

	test("lists the sessions of every project when no cwd is asked for, ordered like the SDK", async () => {
		for (const [index, name] of ["a", "b", "c"].entries())
			seed(world.project(name), name, new Date(Date.UTC(2026, 1, 1 + index)));
		const ours = (await everyPage({ archived: false }, 2)).map((row) => row.session.sessionId);
		const sdk = (await world.sdk.listSessions({})).map((row) => row.sessionId);
		expect(ours).toEqual(sdk);
		expect(ours).toHaveLength(3);
	});

	test("refuses a cursor it did not mint and one minted for another listing", async () => {
		const cwd = world.project("cursors");
		for (let n = 0; n < 4; n++) seed(cwd, `p${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		const first = await world.store.list({ cwd, archived: false }, { limit: 2 }, world.live);
		if (first.status !== "accepted" || first.page.nextCursor === undefined) throw new Error("expected a second page");
		for (const cursor of ["not-a-cursor", "AAAA", first.page.nextCursor]) {
			const query =
				cursor === first.page.nextCursor ? { cwd: world.project("other"), archived: false } : { cwd, archived: false };
			const result = await world.store.list(query, { limit: 2, cursor }, world.live);
			expect(result.status === "rejected" && result.rejection.code).toBe("invalid_input");
		}
	});

	test("archived is always empty, and a session is never archived", async () => {
		const cwd = world.project("archive");
		seed(cwd, "x", new Date());
		const archived = await world.store.list({ cwd, archived: true }, { limit: 10 }, world.live);
		expect(archived.status === "accepted" && archived.page.items).toEqual([]);
		const active = await everyPage({ cwd, archived: false }, 10);
		expect(active.every((row) => row.archived === false)).toBe(true);
	});

	test("a page reads at most limit + 32 rows, however deep it is", async () => {
		const cwd = world.project("cost");
		for (let n = 0; n < 130; n++) seed(cwd, `p${n}`, new Date(Date.UTC(2026, 0, 1) + n * 60_000));
		let cursor: string | undefined;
		const costs: number[] = [];
		do {
			const before = world.calls.getSessionInfo;
			const result = await world.store.list(
				{ cwd, archived: false },
				{ limit: 20, ...(cursor !== undefined && { cursor }) },
				world.live,
			);
			if (result.status !== "accepted") throw new Error("rejected");
			costs.push(world.calls.getSessionInfo - before);
			cursor = result.page.nextCursor;
		} while (cursor !== undefined);
		expect(costs.length).toBe(7);
		expect(Math.max(...costs)).toBeLessThanOrEqual(20 + 32);
		expect(world.calls.listSessions).toBe(0);
	});

	test("skips the project directories of other cwds once it has seen them", async () => {
		const mine = world.project("mine");
		for (let n = 0; n < 3; n++) seed(mine, `m${n}`, new Date(Date.UTC(2026, 0, 1 + n)));
		for (const name of ["x", "y", "z"])
			for (let n = 0; n < 6; n++) seed(world.project(name), `${name}${n}`, new Date(Date.UTC(2026, 5, 1 + n)));
		const query = { cwd: mine, archived: false };
		await everyPage(query, 50);
		const before = world.calls.getSessionInfo;
		const again = await everyPage(query, 50);
		expect(again).toHaveLength(3);
		expect(world.calls.getSessionInfo - before).toBe(3);
	});
});

describe("rows", () => {
	test("a row carries the SDK's title, its source, the journal's origin and the live facts", async () => {
		const cwd = world.project("rows");
		const first = seed(cwd, "the first prompt", new Date(Date.UTC(2026, 0, 1)));
		const owned = seed(cwd, "mine", new Date(Date.UTC(2026, 0, 2)));
		await world.ownership.claim(owned);
		world.live.rows.set(owned, { status: "running", modelId: "opus" });
		const rows = await everyPage({ cwd, archived: false }, 10);
		const byId = new Map(rows.map((row) => [row.session.sessionId, row]));
		expect(byId.get(first)).toMatchObject({
			title: { text: "the first prompt", source: "first_prompt" },
			origin: "external",
			status: "unknown",
		});
		expect(byId.get(owned)).toMatchObject({
			origin: "broski",
			status: "running",
			modelId: "opus",
		});
		const found = await world.store.get(first, world.live);
		expect(found.status === "accepted" && found.summary.session.sessionId).toBe(first);
		const missing = await world.store.get(crypto.randomUUID(), world.live);
		expect(missing.status === "rejected" && missing.rejection.code).toBe("not_found");
		const odd = await world.store.get("not-a-uuid", world.live);
		expect(odd.status === "rejected" && odd.rejection.code).toBe("not_found");
	});
});
