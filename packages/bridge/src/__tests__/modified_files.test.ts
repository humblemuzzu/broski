/**
 * Modified Files Tests
 *
 * Tests the per-file modified files pipeline used by the sidebar:
 * - CC: scanCCFileDiffs + getCCModifiedFiles (structuredPatch, oldString/newString)
 * - Codex: scanCxFileDiffs + getCxModifiedFiles (apply_patch, fileChange items)
 * - Shared: deduplicateFileDiffs (merges same-file edits)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCCModifiedFiles } from "../connectors/claude-code/cc-session-stats";
import { getCxModifiedFiles } from "../connectors/codex/cx-session-stats";
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

// ── Codex Modified Files ─────────────────────────────────────────────

describe("getCxModifiedFiles", () => {
	test("extracts from custom_tool_call apply_patch", async () => {
		const patchInput = `*** Update File: src/server.ts
--- a/src/server.ts
+++ b/src/server.ts
@@ -10,3 +10,5 @@
 context
-old line
+new line 1
+new line 2
+new line 3
 context`;
		const fp = await makeTempJsonl([
			{
				type: "response_item",
				payload: {
					type: "custom_tool_call",
					name: "apply_patch",
					input: patchInput,
				},
			},
		]);
		const files = await getCxModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("src/server.ts");
		expect(files[0]?.additions).toBe(3);
		expect(files[0]?.deletions).toBe(1);
	});

	test("extracts from function_call apply_patch", async () => {
		const patchContent = `*** Add File: src/new.ts
+line 1
+line 2`;
		const fp = await makeTempJsonl([
			{
				type: "response_item",
				payload: {
					type: "function_call",
					name: "apply_patch",
					arguments: JSON.stringify({ patch: patchContent }),
				},
			},
		]);
		const files = await getCxModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("src/new.ts");
		expect(files[0]?.additions).toBe(2);
	});

	test("extracts from v2 fileChange items", async () => {
		const fp = await makeTempJsonl([
			{
				type: "event_msg",
				payload: {
					item: {
						type: "fileChange",
						changes: [
							{
								path: "lib/widget.dart",
								diff: "--- a/lib/widget.dart\n+++ b/lib/widget.dart\n@@ -1,2 +1,3 @@\n context\n-old\n+new1\n+new2",
							},
						],
					},
				},
			},
		]);
		const files = await getCxModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("lib/widget.dart");
		expect(files[0]?.additions).toBe(2);
		expect(files[0]?.deletions).toBe(1);
	});

	test("merges same file from different events", async () => {
		const fp = await makeTempJsonl([
			{
				type: "event_msg",
				payload: {
					item: {
						type: "fileChange",
						changes: [{ path: "app.ts", diff: "+line1\n+line2" }],
					},
				},
			},
			{
				type: "event_msg",
				payload: {
					item: {
						type: "fileChange",
						changes: [{ path: "app.ts", diff: "-removed\n+added" }],
					},
				},
			},
		]);
		const files = await getCxModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0]?.file).toBe("app.ts");
		expect(files[0]?.additions).toBe(3); // 2 + 1
		expect(files[0]?.deletions).toBe(1); // 0 + 1
	});

	test("returns empty for nonexistent file", async () => {
		const files = await getCxModifiedFiles("/nonexistent/path.jsonl");
		expect(files).toHaveLength(0);
	});
});
