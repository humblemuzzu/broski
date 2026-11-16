/** A row's `updatedAt` is when its conversation last moved, not when the CLI last appended bookkeeping to its file. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, utimesSync } from "node:fs";
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

/** What a CLI that resumed a session appends when it ends, none of it stamped (seen in real transcripts). */
function bookkeeping(sessionId: string, padding = 0): string {
	const entries = [
		{ type: "last-prompt", lastPrompt: "hi", sessionId },
		{ type: "cost-state", sessionId, totalCostUSD: 1.5, totalDuration: 70_047_161 },
		{ type: "file-history-snapshot", messageId: crypto.randomUUID(), snapshot: { pad: "f".repeat(padding) } },
		{ type: "session-owner", accountUuid: crypto.randomUUID(), sessionId },
		{ type: "tools-used", tools: ["Bash", "Read"], sessionId },
		{ type: "cost-state", sessionId, totalCostUSD: 1.5, totalDuration: 70_982_914 },
	];
	return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

interface Seeded {
	readonly sessionId: string;
	readonly path: string;
	/** The last message's time. */
	readonly lastMessageAt: number;
}

function seed(cwd: string, startedAt: number, writtenAt: number): Seeded {
	const sessionId = crypto.randomUUID();
	const builder = new TranscriptBuilder(sessionId, cwd, startedAt);
	builder.user("a prompt");
	builder.text(`msg_${sessionId.slice(0, 8)}`, "an answer");
	const { path } = builder.write(world.home.configDir);
	utimesSync(path, new Date(writtenAt), new Date(writtenAt));
	return { sessionId, path, lastMessageAt: startedAt + 2_000 };
}

function resumedAndClosed(seeded: Seeded, at: number, padding = 0): void {
	appendFileSync(seeded.path, bookkeeping(seeded.sessionId, padding));
	utimesSync(seeded.path, new Date(at), new Date(at));
}

async function everyPage(query: SessionQuery, limit: number): Promise<SessionSummary[]> {
	const rows: SessionSummary[] = [];
	let cursor: string | undefined;
	do {
		const result = await world.store.list(query, { limit, ...(cursor !== undefined && { cursor }) }, world.live);
		if (result.status === "rejected") throw new Error(result.rejection.message);
		rows.push(...result.page.items);
		cursor = result.page.nextCursor;
	} while (cursor !== undefined);
	return rows;
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

describe("a session a CLI resumed and then closed", () => {
	test("keeps the time of its last message, listed and read", async () => {
		const cwd = world.project("resumed");
		const seeded = seed(cwd, T0, T0 + 5_000);
		resumedAndClosed(seeded, T0 + 40 * DAY);
		const [row] = await everyPage({ cwd }, 10);
		expect(row?.updatedAt).toBe(seeded.lastMessageAt);
		const found = await world.store.get(seeded.sessionId, world.live);
		expect(found.status === "accepted" && found.summary.updatedAt).toBe(seeded.lastMessageAt);
	});

	test("is passed over by a bookkeeping tail longer than the first window", async () => {
		const cwd = world.project("long-tail");
		const seeded = seed(cwd, T0, T0 + 5_000);
		resumedAndClosed(seeded, T0 + DAY, 300_000);
		const [row] = await everyPage({ cwd }, 10);
		expect(row?.updatedAt).toBe(seeded.lastMessageAt);
	});

	test("is listed by its last message, behind sessions that moved since, on every page size", async () => {
		const cwd = world.project("order");
		const resumed = seed(cwd, T0, T0 + 5_000);
		const middle = seed(cwd, T0 + 10 * DAY, T0 + 10 * DAY + 5_000);
		const newest = seed(cwd, T0 + 20 * DAY, T0 + 20 * DAY + 5_000);
		resumedAndClosed(resumed, T0 + 30 * DAY);
		const expected = [newest, middle, resumed].map((seeded) => seeded.sessionId);
		for (const limit of [1, 2, 200]) {
			const rows = await everyPage({ cwd }, limit);
			expect(rows.map((row) => row.session.sessionId)).toEqual(expected);
			expect(rows.map((row) => row.updatedAt)).toEqual([newest, middle, resumed].map((s) => s.lastMessageAt));
		}
	});

	test("moves again when a message is added, and a message still being written does not count", async () => {
		const cwd = world.project("moves");
		const seeded = seed(cwd, T0, T0 + 5_000);
		resumedAndClosed(seeded, T0 + DAY);
		const later = new Date(T0 + 2 * DAY).toISOString();
		const torn = JSON.stringify({ type: "user", timestamp: new Date(T0 + 3 * DAY).toISOString() }).slice(0, -5);
		appendFileSync(
			seeded.path,
			`${JSON.stringify({ type: "user", timestamp: later, sessionId: seeded.sessionId })}\n${torn}`,
		);
		utimesSync(seeded.path, new Date(T0 + 4 * DAY), new Date(T0 + 4 * DAY));
		const [row] = await everyPage({ cwd }, 10);
		expect(row?.updatedAt).toBe(T0 + 2 * DAY);
	});

	test("never reads later than its file was written", async () => {
		const cwd = world.project("clock");
		seed(cwd, T0 + DAY, T0);
		const [row] = await everyPage({ cwd }, 10);
		expect(row?.updatedAt).toBe(T0);
	});
});
