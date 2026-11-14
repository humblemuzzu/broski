/**
 * Real sizes, under a memory watchdog (AGENTS.md test hygiene): a 50 MB transcript read page by page, and a project of
 * 500 sessions listed page by page. The numbers go to the console; the assertions are the bounds the plan promises.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import type { TranscriptItem } from "../../../contract";
import { writeLargeTranscript } from "./helpers/large-transcript";
import { mib, startWatchdog } from "./helpers/memory-watchdog";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

const WATCHDOG_LIMIT = 3 * 1_024 * 1_048_576;
let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

async function readAll(
	sessionId: string,
	limit: number,
): Promise<{ items: TranscriptItem[]; pages: number; slowest: number }> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	let pages = 0;
	let slowest = 0;
	do {
		const started = performance.now();
		const result = await world.store.transcript(
			sessionId,
			{ limit, ...(cursor !== undefined && { cursor }) },
			world.live,
		);
		if (result.status !== "accepted") throw new Error(result.rejection.message);
		slowest = Math.max(slowest, performance.now() - started);
		items.push(...result.page.items);
		cursor = result.page.nextCursor;
		pages += 1;
	} while (cursor !== undefined && pages < 10);
	return { items, pages, slowest };
}

describe("a 50 MB transcript", () => {
	test.each([
		["no compaction", undefined],
		["compacted a third of the way in", 1_500],
	])(
		"%s: the newest pages come back within the memory budget",
		async (_name, compactAfterTurn) => {
			const cwd = world.project("big");
			const written = writeLargeTranscript(world.home.configDir, cwd, {
				targetBytes: 50 * 1_048_576,
				compactAfterTurn,
			});
			const watchdog = startWatchdog(WATCHDOG_LIMIT, "50 MB transcript");
			const baseline = process.memoryUsage().rss;
			const first = performance.now();
			const page = await world.store.transcript(written.sessionId, { limit: 50 }, world.live);
			const firstMs = performance.now() - first;
			if (page.status !== "accepted") throw new Error(page.rejection.message);
			const firstPeak = watchdog.peak();
			const later = await readAll(written.sessionId, 200);
			const last = await world.store.lastChainUuid(written.sessionId);
			watchdog.stop();
			console.log(
				`50 MB (${written.entries} entries, ${mib(written.bytes)} MiB, ${_name}): first page ${Math.round(firstMs)} ms, peak RSS ${mib(watchdog.peak())} MiB (+${mib(watchdog.peak() - baseline)} over ${mib(baseline)}), after the first page ${mib(firstPeak)} MiB; next pages ${later.pages} in total, slowest ${Math.round(later.slowest)} ms`,
			);
			expect(page.page.items).toHaveLength(50);
			expect(page.page.items[0]).toMatchObject({ kind: "block" });
			expect(last).toBe(written.lastUuid);
			expect(later.items.length).toBe(200 * later.pages);
			expect(watchdog.peak()).toBeLessThan(WATCHDOG_LIMIT);
		},
		180_000,
	);
});

describe("a project of 500 sessions", () => {
	test("pages of 50 keep their cost flat, whichever page", async () => {
		const cwd = world.project("many");
		for (let n = 0; n < 500; n++) {
			const b = new TranscriptBuilder(crypto.randomUUID(), cwd);
			b.user(`prompt ${n}`);
			b.text(`msg_${n}`, `answer ${n}`);
			const { path } = b.write(world.home.configDir);
			const at = new Date(Date.UTC(2026, 0, 1) + n * 1000);
			utimesSync(path, at, at);
		}
		const watchdog = startWatchdog(WATCHDOG_LIMIT, "500 sessions");
		let cursor: string | undefined;
		const costs: number[] = [];
		const times: number[] = [];
		let rows = 0;
		do {
			const reads = world.calls.getSessionInfo;
			const started = performance.now();
			const result = await world.store.list(
				{ cwd },
				{ limit: 50, ...(cursor !== undefined && { cursor }) },
				world.live,
			);
			if (result.status !== "accepted") throw new Error(result.rejection.message);
			times.push(performance.now() - started);
			costs.push(world.calls.getSessionInfo - reads);
			rows += result.page.items.length;
			cursor = result.page.nextCursor;
		} while (cursor !== undefined);
		watchdog.stop();
		const sdkStarted = performance.now();
		const deepest = await world.sdk.listSessions({ dir: cwd, includeWorktrees: false, limit: 50, offset: 450 });
		const sdkMs = performance.now() - sdkStarted;
		console.log(
			`500 sessions: ${costs.length} pages, lite reads per page ${Math.min(...costs)}..${Math.max(...costs)}, page time ${Math.round(Math.min(...times))}..${Math.round(Math.max(...times))} ms, peak RSS ${mib(watchdog.peak())} MiB; the SDK's own offset-450 page: ${Math.round(sdkMs)} ms for ${deepest.length} rows`,
		);
		expect(rows).toBe(500);
		expect(costs).toHaveLength(10);
		expect(Math.max(...costs)).toBeLessThanOrEqual(50 + 32);
		expect(world.calls.listSessions).toBe(1);
	}, 120_000);
});
