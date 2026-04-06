/**
 * Modified Files Tests
 *
 * Tests the per-file modified files pipeline used by the sidebar:
 * - CC: scanCCFileDiffs + getCCModifiedFiles (structuredPatch, oldString/newString)
 * - Codex: scanCxFileDiffs + getCxModifiedFiles (apply_patch, fileChange items)
 * - Pi: scanPiFileDiffs + getPiModifiedFiles (edit tool details.diff, write tool)
 * - Shared: deduplicateFileDiffs (merges same-file edits)
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deduplicateFileDiffs } from "../handlers/session-stats";
import { getCCModifiedFiles } from "../connectors/claude-code/cc-session-stats";
import { getCxModifiedFiles } from "../connectors/codex/cx-session-stats";
import { getPiModifiedFiles } from "../connectors/pi/pi-session-stats";

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
							lines: [" context line", "-old line 1", "-old line 2", "+new line 1", "+new line 2", "+new line 3", " context"],
						},
					],
				},
			},
		]);
		const files = await getCCModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0].file).toBe("lib/main.dart");
		expect(files[0].additions).toBe(3);
		expect(files[0].deletions).toBe(2);
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
		expect(files[0].file).toBe("src/utils.ts");
		expect(files[0].additions).toBe(2); // 5 lines - 3 lines
		expect(files[0].deletions).toBe(0);
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
		expect(files[0].file).toBe("lib/main.dart");
		expect(files[0].additions).toBe(3); // 2 + 1
		expect(files[0].deletions).toBe(2); // 1 + 1
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
		expect(files[0].file).toBe("real.dart");
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
		expect(files[0].file).toBe("src/server.ts");
		expect(files[0].additions).toBe(3);
		expect(files[0].deletions).toBe(1);
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
		expect(files[0].file).toBe("src/new.ts");
		expect(files[0].additions).toBe(2);
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
		expect(files[0].file).toBe("lib/widget.dart");
		expect(files[0].additions).toBe(2);
		expect(files[0].deletions).toBe(1);
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
		expect(files[0].file).toBe("app.ts");
		expect(files[0].additions).toBe(3); // 2 + 1
		expect(files[0].deletions).toBe(1); // 0 + 1
	});

	test("returns empty for nonexistent file", async () => {
		const files = await getCxModifiedFiles("/nonexistent/path.jsonl");
		expect(files).toHaveLength(0);
	});
});

// ── Pi Modified Files ────────────────────────────────────────────────

describe("getPiModifiedFiles", () => {
	test("edit tool: gets path from details.filePath + diff from content text (real Pi format)", async () => {
		// Real Pi format: diff is in content[0].text, path is in details.filePath
		const diff = `--- widget.dart\toriginal
+++ widget.dart\tmodified
@@ -10,3 +10,4 @@
     required this.onModelTap,
     required this.onSetPiThinkingLevel,
+    this.onMenuTap,
   });`;
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "tc-edit-1",
							name: "edit",
							arguments: { path: "/Users/me/project/lib/widget.dart", old_str: "a", new_str: "b" },
						},
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "edit",
					toolCallId: "tc-edit-1",
					details: { filePath: "/Users/me/project/lib/widget.dart" },
					content: [{ type: "text", text: diff }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0].file).toBe("/Users/me/project/lib/widget.dart");
		expect(files[0].additions).toBe(1);
		expect(files[0].deletions).toBe(0);
	});

	test("edit tool: uses details.diff when available (older Pi format)", async () => {
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "edit",
					toolCallId: "tc-orphan",
					details: { filePath: "lib/widget.dart", diff: "-1 old line\n+1 new line 1\n+2 new line 2" },
					content: [{ type: "text", text: "Successfully replaced 1 block(s) in lib/widget.dart." }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0].file).toBe("lib/widget.dart");
		expect(files[0].additions).toBe(2);
		expect(files[0].deletions).toBe(1);
	});

	test("write tool: gets REAL line count from toolCall arguments.content", async () => {
		const fileContent = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10";
		const fp = await makeTempJsonl([
			// Assistant message with the full file content in arguments
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "tc-write-1",
							name: "write",
							arguments: {
								path: "src/new_file.py",
								content: fileContent,
							},
						},
					],
				},
			},
			// toolResult just confirms the write
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "write",
					toolCallId: "tc-write-1",
					content: [{ type: "text", text: "Successfully wrote 100 bytes to src/new_file.py" }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0].file).toBe("src/new_file.py");
		expect(files[0].additions).toBe(10); // exactly 10 lines, not an estimate
		expect(files[0].deletions).toBe(0);
	});

	test("write tool: skipped when no toolCall arguments found", async () => {
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "write",
					toolCallId: "tc-orphan",
					content: [{ type: "text", text: "Successfully wrote 500 bytes to orphan.py" }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		// No toolCall args found → no way to get real data → skip
		expect(files).toHaveLength(0);
	});

	test("handles multiple edits and writes to different files", async () => {
		const editDiff = "--- a.py\toriginal\n+++ a.py\tmodified\n@@ -1,1 +1,2 @@\n old\n+added line";
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "tc-1", name: "edit", arguments: { path: "a.py", old_str: "old", new_str: "new" } },
						{ type: "toolCall", id: "tc-2", name: "write", arguments: { path: "b.py", content: "#!/usr/bin/env python\nprint('hello')\nprint('world')" } },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "edit",
					toolCallId: "tc-1",
					details: { filePath: "a.py" },
					content: [{ type: "text", text: editDiff }],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "write",
					toolCallId: "tc-2",
					content: [{ type: "text", text: "Successfully wrote 50 bytes to b.py" }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(2);
		expect(files.find((f) => f.file === "a.py")?.additions).toBe(1);
		const bFile = files.find((f) => f.file === "b.py");
		expect(bFile?.additions).toBe(3); // 3 real lines
		expect(bFile?.deletions).toBe(0);
	});

	test("merges repeated edits to same file", async () => {
		const diff1 = "--- app.py\toriginal\n+++ app.py\tmodified\n@@ -1 +1,3 @@\n+line1\n+line2";
		const diff2 = "--- app.py\toriginal\n+++ app.py\tmodified\n@@ -5 +5 @@\n-old\n+new";
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "tc-1", name: "edit", arguments: { path: "app.py", old_str: "a", new_str: "b" } },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "edit",
					toolCallId: "tc-1",
					details: { filePath: "app.py" },
					content: [{ type: "text", text: diff1 }],
				},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{ type: "toolCall", id: "tc-2", name: "edit", arguments: { path: "app.py", old_str: "x", new_str: "y" } },
					],
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "edit",
					toolCallId: "tc-2",
					details: { filePath: "app.py" },
					content: [{ type: "text", text: diff2 }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(1);
		expect(files[0].file).toBe("app.py");
		expect(files[0].additions).toBe(3); // 2 + 1
		expect(files[0].deletions).toBe(1); // 0 + 1
	});

	test("skips non-edit non-write tool results", async () => {
		const fp = await makeTempJsonl([
			{
				type: "message",
				message: {
					role: "toolResult",
					toolName: "bash",
					toolCallId: "tc-1",
					content: [{ type: "text", text: "ls output" }],
				},
			},
		]);
		const files = await getPiModifiedFiles(fp);
		expect(files).toHaveLength(0);
	});

	test("returns empty for nonexistent file", async () => {
		const files = await getPiModifiedFiles("/nonexistent/path.jsonl");
		expect(files).toHaveLength(0);
	});
});
