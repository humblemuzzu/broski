/** A Claude Code listing searched, and paged on a kept ranking while its sessions move. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { RankedListings } from "../../../backends/claude-code/store/ranked-listing";
import type { SessionQuery, SessionSummary } from "../../../contract";
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

async function page(query: SessionQuery, limit: number, cursor?: string) {
	const result = await world.store.list(query, { limit, ...(cursor !== undefined && { cursor }) }, world.live);
	if (result.status === "rejected") throw new Error(result.rejection.message);
	return result.page;
}

async function everyPage(query: SessionQuery, limit: number): Promise<SessionSummary[]> {
	const rows: SessionSummary[] = [];
	let cursor: string | undefined;
	do {
		const next = await page(query, limit, cursor);
		rows.push(...next.items);
		cursor = next.nextCursor;
	} while (cursor !== undefined);
	return rows;
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

describe("searching", () => {
	test("matches every word of the title or the folder's name, on every page", async () => {
		const app = world.project("shop-app");
		const site = world.project("website");
		const login = seed(app, "Fix the login flow", day(3));
		const docs = seed(app, "Write the docs", day(2));
		const build = seed(site, "Fix the build", day(1));
		const ids = async (search: string, limit = 200) =>
			(await everyPage({ search }, limit)).map((row) => row.session.sessionId);

		expect(await ids("FIX")).toEqual([login, build]);
		expect(await ids("fix shop-app")).toEqual([login]);
		expect(await ids("shop-app")).toEqual([login, docs]);
		expect(await ids("fix docs")).toEqual([]);
		expect(await ids("fix", 1)).toEqual([login, build]);
	});
});

describe("paging on a kept ranking", () => {
	test("a session that moves while pages are read is not listed again below the cursor, and the rest stay in order", async () => {
		const cwd = world.project("paging");
		const ids = Array.from({ length: 6 }, (_, n) => seed(cwd, `prompt ${n}`, day(10 - n)));
		const id = (index: number): string => ids[index] ?? "";
		const first = await page({ cwd }, 2);
		expect(first.items.map((row) => row.session.sessionId)).toEqual(ids.slice(0, 2));

		seed(cwd, "moved", day(20), id(4));
		const rest: SessionSummary[] = [];
		let cursor = first.nextCursor;
		while (cursor !== undefined) {
			const next = await page({ cwd }, 2, cursor);
			rest.push(...next.items);
			cursor = next.nextCursor;
		}
		expect(rest.map((row) => row.session.sessionId)).toEqual([id(2), id(3), id(5)]);
		const times = rest.map((row) => row.updatedAt);
		expect(times).toEqual([...times].sort((a, b) => b - a));
		expect((await page({ cwd }, 1)).items[0]?.session.sessionId).toBe(id(4));
	});
});

describe("RankedListings", () => {
	interface Row {
		readonly at: number;
		readonly sessionId: string;
	}
	const rowsOf = (count: number): Row[] =>
		Array.from({ length: count }, (_, n) => ({ at: 1_000 - n, sessionId: `s${n}` }));
	async function drain(rows: AsyncGenerator<Row>, count: number): Promise<Row[]> {
		const taken: Row[] = [];
		for await (const row of rows) {
			taken.push(row);
			if (taken.length === count) break;
		}
		return taken;
	}

	test("ranks once for a listing's pages, again for its first page, and again once it is no longer kept", async () => {
		let now = 0;
		let ranked = 0;
		const listings = new RankedListings<Row>(() => now);
		const rank = () => {
			ranked += 1;
			return (async function* () {
				yield* rowsOf(10);
			})();
		};
		const first = await drain(listings.rows("k", undefined, rank), 3);
		const second = await drain(listings.rows("k", first.at(-1), rank), 3);
		expect(second.map((row) => row.sessionId)).toEqual(["s3", "s4", "s5"]);
		expect(ranked).toBe(1);

		await drain(listings.rows("k", undefined, rank), 1);
		expect(ranked).toBe(2);

		now += 31_000;
		const late = await drain(listings.rows("k", second.at(-1), rank), 10);
		expect(late.map((row) => row.sessionId)).toEqual(["s6", "s7", "s8", "s9"]);
		expect(ranked).toBe(3);
	});

	test("a ranking that failed is not read as finished by the next page", async () => {
		const listings = new RankedListings<Row>(() => 0);
		let ranked = 0;
		const rank = () => {
			ranked += 1;
			const failing = ranked === 1;
			return (async function* () {
				yield* rowsOf(2);
				if (failing) throw new Error("a directory could not be read");
				yield* rowsOf(4).slice(2);
			})();
		};
		const first = await drain(listings.rows("k", undefined, rank), 2);
		await expect(drain(listings.rows("k", first.at(-1), rank), 2)).rejects.toThrow("could not be read");
		const again = await drain(listings.rows("k", first.at(-1), rank), 2);
		expect(again.map((row) => row.sessionId)).toEqual(["s2", "s3"]);
		expect(ranked).toBe(2);
	});

	test("keeps at most sixteen listings, dropping the one used longest ago", async () => {
		let ranked = 0;
		const listings = new RankedListings<Row>(() => 0);
		const rank = () => {
			ranked += 1;
			return (async function* () {
				yield* rowsOf(3);
			})();
		};
		for (let n = 0; n < 17; n += 1) await drain(listings.rows(`k${n}`, undefined, rank), 1);
		const after = { at: 1_000, sessionId: "s0" };
		await drain(listings.rows("k16", after, rank), 1);
		expect(ranked).toBe(17);
		await drain(listings.rows("k0", after, rank), 1);
		expect(ranked).toBe(18);
	});
});
