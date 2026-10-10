import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrichPiSessionsWithStats, PI_STATS_SCAN_CONCURRENCY } from "../connectors/pi/pi-session-enrich";
import {
	clearPiStatsCache,
	computePiSessionStats,
	countSubagentTools,
	getPiStatsCacheStats,
	PI_STATS_CACHE_BYTES,
} from "../connectors/pi/pi-session-stats";
import type { PiSessionInfo } from "../types/pi";

let tmpDirs: string[] = [];

async function makeSessionFile(name: string, lines: object[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-pi-enrich-"));
	tmpDirs.push(dir);
	const filePath = join(dir, name);
	await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return filePath;
}

function sessionFixture(path: string): PiSessionInfo {
	return { path, id: path, cwd: "/tmp", created: 0, modified: 0, messageCount: 0, firstMessage: "" };
}

function writePair(index: number, contentLinesPerWrite: number): object[] {
	const path = `file-${index}.ts`;
	const content = Array.from({ length: contentLinesPerWrite }, (_, line) => `line ${line}`).join("\n");
	return [
		{
			type: "message",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: `tc-${index}`, name: "write", arguments: { path, content } }],
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolName: "write",
				toolCallId: `tc-${index}`,
				content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
			},
		},
	];
}

afterEach(async () => {
	for (const dir of tmpDirs) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	tmpDirs = [];
});

describe("enrichPiSessionsWithStats", () => {
	test("scans sessions with a bounded number of concurrent reads", async () => {
		const sessions = Array.from({ length: 40 }, (_, index) => sessionFixture(`/tmp/pi-session-${index}.jsonl`));
		const scanned: string[] = [];
		let inFlight = 0;
		let peakInFlight = 0;

		await enrichPiSessionsWithStats(sessions, async (path) => {
			inFlight++;
			peakInFlight = Math.max(peakInFlight, inFlight);
			scanned.push(path);
			await Bun.sleep(5);
			inFlight--;
			return { summary: { additions: 1, deletions: 0, files: 1 }, toolCount: 1 };
		});

		expect(peakInFlight).toBeLessThanOrEqual(PI_STATS_SCAN_CONCURRENCY);
		expect(scanned).toHaveLength(sessions.length);
		expect(new Set(scanned).size).toBe(sessions.length);
		for (const session of sessions) {
			expect(session.summary).toEqual({ additions: 1, deletions: 0, files: 1 });
			expect(session.subagentToolCount).toBe(1);
		}
	});

	test("leaves sessions without file changes unmarked", async () => {
		const sessions = [sessionFixture("/tmp/pi-empty-session.jsonl")];

		await enrichPiSessionsWithStats(sessions, async () => ({
			summary: { additions: 0, deletions: 0, files: 0 },
			toolCount: 0,
		}));

		expect(sessions[0]?.summary).toBeUndefined();
		expect(sessions[0]?.subagentToolCount).toBeUndefined();
	});

	test("streams multi-megabyte session files and counts every write once", async () => {
		const writes = 400;
		const lines: object[] = [];
		for (let index = 0; index < writes; index++) {
			lines.push(...writePair(index, 12));
		}
		const filePath = await makeSessionFile("large.jsonl", lines);

		const summary = await computePiSessionStats(filePath);

		expect(summary).toEqual({ additions: writes * 12, deletions: 0, files: writes });
	});

	test("counts a session's diffs exactly once per file regardless of line count", async () => {
		const lines = [...writePair(0, 4), ...writePair(1, 4), ...writePair(0, 6)];
		const filePath = await makeSessionFile("repeat.jsonl", lines);

		const summary = await computePiSessionStats(filePath);

		expect(summary).toEqual({ additions: 14, deletions: 0, files: 2 });
	});
});

describe("pi-session-scan cache", () => {
	test("serves an unchanged file from cache", async () => {
		const filePath = await makeSessionFile("cached.jsonl", writePair(0, 3));
		const first = await computePiSessionStats(filePath);
		await appendFile(filePath, "");
		const second = await computePiSessionStats(filePath);
		expect(second).toEqual(first);
	});

	test("clearing the stats cache forces a re-scan of an unchanged file", async () => {
		const subagentLine = {
			type: "message",
			message: { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "finder", arguments: {} }] },
		};
		const filePath = await makeSessionFile("subagent.jsonl", [subagentLine]);
		expect(await countSubagentTools(filePath)).toBe(1);

		clearPiStatsCache(filePath);
		expect(await countSubagentTools(filePath)).toBe(1);

		clearPiStatsCache();
		expect(await countSubagentTools(filePath)).toBe(1);
	});

	test("re-scans a file whose content changed even when its mtime did not", async () => {
		const stamp = 1_700_000_000;
		const subagentLine = {
			type: "message",
			message: { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "finder", arguments: {} }] },
		};
		const filePath = await makeSessionFile("subagent-rewritten.jsonl", [subagentLine]);
		await utimes(filePath, stamp, stamp);
		expect(await countSubagentTools(filePath)).toBe(1);

		await writeFile(filePath, `${JSON.stringify({ type: "message", message: { role: "assistant", content: [] } })}\n`);
		await utimes(filePath, stamp, stamp);
		expect(await countSubagentTools(filePath)).toBe(0);
	});

	test("serves a repeated scan of the same file from cache", async () => {
		const filePath = await makeSessionFile("repeat-scan.jsonl", writePair(0, 3));
		await computePiSessionStats(filePath);

		const before = getPiStatsCacheStats();
		const again = await computePiSessionStats(filePath);
		const after = getPiStatsCacheStats();

		expect(again).toEqual({ additions: 3, deletions: 0, files: 1 });
		expect(after.hits).toBe(before.hits + 1);
		expect(after.bytes).toBeLessThanOrEqual(PI_STATS_CACHE_BYTES);
	});
});
