/**
 * Parity of the merged single-pass Pi stats scan against the two-pass `readline` scan it replaced:
 * same diff summary, same subagent tool count, same modified-file list, on generated and on this
 * machine's real session files (read-only).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	legacyComputePiSessionStats,
	legacyCountSubagentTools,
	legacyGetPiModifiedFiles,
} from "../../bench/lib/pi-stats-oracle";
import {
	clearPiStatsCache,
	computePiSessionStats,
	countSubagentTools,
	getPiModifiedFiles,
	scanPiSessionStats,
} from "../connectors/pi/pi-session-stats";

const REAL_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const REAL_FILE_COUNT = 12;
/** These tests read real files, so they get a budget that survives a loaded machine. */
const TEST_TIMEOUT_MS = 60_000;

let root = "";

const assistantWithToolCall = (id: string, name: string, args: Record<string, unknown>) => ({
	type: "message",
	id: `a-${id}`,
	parentId: null,
	timestamp: "2026-01-01T00:00:00.000Z",
	message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: 1 },
});

const toolResult = (id: string, toolName: string, text: string, details?: unknown) => ({
	type: "message",
	id: `r-${id}`,
	parentId: null,
	timestamp: "2026-01-01T00:00:01.000Z",
	message: {
		role: "toolResult",
		toolCallId: id,
		toolName,
		content: [{ type: "text", text }],
		...(details === undefined ? {} : { details }),
		isError: false,
		timestamp: 2,
	},
});

const editDiff = (file: string, additions: number, deletions: number): string => {
	const lines = [`--- ${file}`, `+++ ${file}`, "@@ -1,1 +1,1 @@"];
	for (let i = 0; i < additions; i++) lines.push(`+line ${i}`);
	for (let i = 0; i < deletions; i++) lines.push(`-gone ${i}`);
	return lines.join("\n");
};

const WRITE_BODY = "line 1\nline 2\nline 3";

function mixedEntries(): object[] {
	return [
		{ type: "session", version: 3, id: "s", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/tmp" },
		assistantWithToolCall("tc-w", "write", { path: "src/a.ts", content: WRITE_BODY }),
		toolResult("tc-w", "write", "Successfully wrote 21 bytes"),
		assistantWithToolCall("tc-e", "edit", { path: "src/b.ts" }),
		toolResult("tc-e", "edit", "Applied", { filePath: "src/b.ts", diff: editDiff("src/b.ts", 4, 2) }),
		assistantWithToolCall("tc-e2", "edit", { path: "src/b.ts" }),
		toolResult("tc-e2", "edit", "Applied again", { diff: editDiff("src/b.ts", 1, 0) }),
		assistantWithToolCall("tc-f", "finder", { query: "x" }),
		assistantWithToolCall("tc-t", "Task", { description: "y" }),
		assistantWithToolCall("tc-read", "read", { path: "src/c.ts" }),
		toolResult("tc-read", "read", "contents"),
		assistantWithToolCall("tc-e3", "edit", {}),
		toolResult("tc-e3", "edit", "no path", { diff: editDiff("src/d.ts", 2, 1) }),
		{ type: "message", message: { role: "assistant", content: "no toolCalls here" } },
		{ type: "message", message: { role: "user", content: "hello" } },
	];
}

async function writeSession(name: string, lines: object[]): Promise<string> {
	const path = join(root, name);
	await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return path;
}

async function expectParity(path: string): Promise<void> {
	clearPiStatsCache(path);
	const expectedSummary = await legacyComputePiSessionStats(path);
	const expectedTools = await legacyCountSubagentTools(path);
	const actual = await scanPiSessionStats(path);

	expect(expectedSummary, `${path} summary`).toEqual(actual.summary);
	expect(actual.toolCount, `${path} toolCount`).toBe(expectedTools);
	expect(await computePiSessionStats(path), `${path} computePiSessionStats`).toEqual(expectedSummary);
	expect(await countSubagentTools(path), `${path} countSubagentTools`).toBe(expectedTools);
	expect(await getPiModifiedFiles(path), `${path} modified`).toEqual(await legacyGetPiModifiedFiles(path));
}

async function collectRealSessions(): Promise<Array<{ path: string; size: number }>> {
	const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
	const found: Array<{ path: string; size: number }> = [];
	let dirs: string[] = [];
	try {
		dirs = await readdir(sessionsRoot);
	} catch {
		return [];
	}
	for (const dir of dirs) {
		let names: string[] = [];
		try {
			names = await readdir(join(sessionsRoot, dir));
		} catch {
			continue;
		}
		for (const name of names) {
			if (!name.endsWith(".jsonl")) continue;
			const path = join(sessionsRoot, dir, name);
			try {
				found.push({ path, size: (await stat(path)).size });
			} catch {}
		}
	}
	return found;
}

describe("Pi stats scan parity", () => {
	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "broski-pi-stats-"));
	});

	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it(
		"matches the two-pass scan on a mixed session",
		async () => {
			await expectParity(await writeSession("mixed.jsonl", mixedEntries()));
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"matches when a write tool call has no matching tool result",
		async () => {
			await expectParity(
				await writeSession("dangling.jsonl", [
					assistantWithToolCall("tc-1", "write", { path: "src/x.ts", content: "a\nb" }),
					assistantWithToolCall("tc-2", "edit", { path: "src/y.ts" }),
				]),
			);
		},
		TEST_TIMEOUT_MS,
	);

	it("matches when edits carry no diff and writes carry no content", async () => {
		await expectParity(
			await writeSession("empty-diffs.jsonl", [
				assistantWithToolCall("tc-1", "edit", { path: "src/a.ts" }),
				toolResult("tc-1", "edit", "no diff at all"),
				assistantWithToolCall("tc-2", "write", { path: "src/b.ts" }),
				toolResult("tc-2", "write", "wrote 0 bytes"),
			]),
		);
	});

	it(
		"matches with CRLF, blank lines, malformed lines and no trailing newline",
		async () => {
			const crlf = join(root, "crlf.jsonl");
			await writeFile(
				crlf,
				mixedEntries()
					.map((line) => JSON.stringify(line))
					.join("\r\n"),
			);
			await expectParity(crlf);

			const noisy = join(root, "noisy.jsonl");
			const lines = mixedEntries().map((line) => JSON.stringify(line));
			lines.splice(3, 0, "", "not json");
			lines.push('{"type":"message","message":{"role":"assistant","content":[{"type":"toolCall"');
			await writeFile(noisy, `${lines.join("\n")}\n`);
			await expectParity(noisy);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"matches on a multi-megabyte session",
		async () => {
			const lines: object[] = [];
			for (let index = 0; index < 300; index++) {
				lines.push(assistantWithToolCall(`tc-${index}`, "write", { path: `src/f-${index}.ts`, content: WRITE_BODY }));
				lines.push(toolResult(`tc-${index}`, "write", `Successfully wrote ${WRITE_BODY.length} bytes`));
			}
			lines.push({
				type: "message",
				message: { role: "toolResult", toolName: "bash", content: "x".repeat(1_000_000) },
			});
			await expectParity(await writeSession("large.jsonl", lines));
		},
		TEST_TIMEOUT_MS,
	);

	it("matches on a missing file", async () => {
		const missing = join(root, "missing.jsonl");
		expect(await scanPiSessionStats(missing).catch(() => null)).toBeNull();
		expect(await computePiSessionStats(missing)).toBeNull();
		expect(await countSubagentTools(missing)).toBe(0);
		expect(await getPiModifiedFiles(missing)).toEqual([]);
	});

	it("agrees with the two-pass scan on this machine's real session files", async () => {
		const sessions = (await collectRealSessions())
			.filter((session) => session.size > 0 && session.size <= REAL_FILE_LIMIT_BYTES)
			.sort((a, b) => b.size - a.size)
			.slice(0, REAL_FILE_COUNT);

		if (sessions.length === 0) {
			console.warn("[pi-stats-parity] no ~/.pi/agent/sessions on this machine — real-data parity skipped");
			return;
		}

		for (const session of sessions) {
			const expectedSummary = await legacyComputePiSessionStats(session.path);
			const expectedTools = await legacyCountSubagentTools(session.path);
			const actual = await scanPiSessionStats(session.path);
			expect(expectedSummary, `${session.path} summary`).toEqual(actual.summary);
			expect(actual.toolCount, `${session.path} toolCount`).toBe(expectedTools);
		}

		console.log(`[pi-stats-parity] checked ${sessions.length} real sessions`);
	}, 300_000);
});
