/**
 * Modified Files Tests
 *
 * Tests the per-file modified files pipeline used by the sidebar:
 * - CC: scanCCFileDiffs + getCCModifiedFiles (structuredPatch, oldString/newString)
 * - Shared: deduplicateFileDiffs (merges same-file edits)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCCModifiedFiles } from "../connectors/claude-code/cc-session-stats";
import { deduplicateFileDiffs } from "../handlers/session-stats";

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

async function makeTempJsonl(lines: object[]): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "broski-test-"));
	tmpDirs.push(dir);
	const filePath = join(dir, "session.jsonl");
	const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
	await writeFile(filePath, content);
	return filePath;
}

afterEach(async () => {
	for (const dir of tmpDirs) {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	tmpDirs = [];
});

// ── deduplicateFileDiffs ─────────────────────────────────────────────

describe("deduplicateFileDiffs", () => {
	test("returns empty array for empty input", () => {
		expect(deduplicateFileDiffs([])).toEqual([]);
	});

	test("passes through single file unchanged", () => {
		const result = deduplicateFileDiffs([{ file: "src/app.ts", additions: 5, deletions: 2 }]);
		expect(result).toEqual([{ file: "src/app.ts", additions: 5, deletions: 2 }]);
	});

	test("merges multiple edits to the same file", () => {
		const result = deduplicateFileDiffs([
			{ file: "src/app.ts", additions: 5, deletions: 2 },
			{ file: "src/app.ts", additions: 3, deletions: 1 },
			{ file: "src/app.ts", additions: 1, deletions: 0 },
		]);
		expect(result).toEqual([{ file: "src/app.ts", additions: 9, deletions: 3 }]);
	});

	test("keeps different files separate", () => {
		const result = deduplicateFileDiffs([
			{ file: "a.ts", additions: 1, deletions: 0 },
			{ file: "b.ts", additions: 2, deletions: 1 },
			{ file: "a.ts", additions: 3, deletions: 0 },
		]);
		expect(result).toHaveLength(2);
		expect(result.find((f) => f.file === "a.ts")).toEqual({ file: "a.ts", additions: 4, deletions: 0 });
		expect(result.find((f) => f.file === "b.ts")).toEqual({ file: "b.ts", additions: 2, deletions: 1 });
	});

	test("skips entries with empty file path", () => {
		const result = deduplicateFileDiffs([
			{ file: "", additions: 10, deletions: 5 },
			{ file: "real.ts", additions: 1, deletions: 0 },
		]);
		expect(result).toEqual([{ file: "real.ts", additions: 1, deletions: 0 }]);
	});
});

// ── CC Modified Files ────────────────────────────────────────────────

describe("getCCModifiedFiles", () => {
	test("extracts file changes from structuredPatch", async () => {
		const fp = await makeTempJsonl([
			{
				toolUseResult: {
					filePath: "lib/main.dart",
					structuredPatch: [
						{
							oldStart: 10,
							oldLines: 3,
							newStart: 10,
							newLines: 5,
							lines: [
								" context line",
								"-old line 1",
								"-old line 2",
								"+new line 1",
								"+new line 2",
								"+new line 3",
								" context",
							],
						},
					],
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("lib/main.dart");
		expect(files[0]?.additions).toBe(3);
		expect(files[0]?.deletions).toBe(2);
	});

	test("extracts from oldString/newString fallback", async () => {
		const fp = await makeTempJsonl([
			{
				toolUseResult: {
					filePath: "src/utils.ts",
					oldString: "line1\nline2\nline3",
					newString: "line1\nline2\nline3\nline4\nline5",
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("src/utils.ts");
		expect(files[0]?.additions).toBe(2); // 5 lines - 3 lines
		expect(files[0]?.deletions).toBe(0);
	});

	test("merges multiple edits to the same file", async () => {
		const fp = await makeTempJsonl([
			{
				toolUseResult: {
					filePath: "lib/main.dart",
					structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ["-old", "+new1", "+new2"] }],
				},
			},
			{
				toolUseResult: {
					filePath: "lib/main.dart",
					structuredPatch: [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, lines: ["-removed", "+added"] }],
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("lib/main.dart");
		expect(files[0]?.additions).toBe(3); // 2 + 1
		expect(files[0]?.deletions).toBe(2); // 1 + 1
	});

	test("handles multiple different files", async () => {
		const fp = await makeTempJsonl([
			{
				toolUseResult: {
					filePath: "a.dart",
					structuredPatch: [{ lines: ["+added"] }],
				},
			},
			{
				toolUseResult: {
					filePath: "b.dart",
					structuredPatch: [{ lines: ["-removed", "+added"] }],
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(2);
		expect(files.find((f) => f.file === "a.dart")?.additions).toBe(1);
		expect(files.find((f) => f.file === "b.dart")?.additions).toBe(1);
		expect(files.find((f) => f.file === "b.dart")?.deletions).toBe(1);
	});

	test("skips non-toolUseResult lines", async () => {
		const fp = await makeTempJsonl([
			{ type: "user", text: "hello" },
			{ type: "assistant", text: "hi" },
			{
				toolUseResult: {
					filePath: "real.dart",
					structuredPatch: [{ lines: ["+line"] }],
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("real.dart");
	});

	test("returns empty for file with no edits", async () => {
		const fp = await makeTempJsonl([
			{ type: "user", text: "just chatting" },
			{ type: "assistant", text: "no file edits here" },
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(0);
	});

	test("returns empty for nonexistent file", async () => {
		const files = await getCCModifiedFiles("/nonexistent/path/session.jsonl");
		expect(files).toHaveLength(0);
	});
});
