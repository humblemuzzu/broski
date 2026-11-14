/**
 * The streamed pass over a transcript file (adapter README D26): spans and system facts for entries of the chain,
 * nothing else.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_RAW_LINE_BYTES, NO_RAW_FACTS, scanRaw } from "../../../backends/claude-code/store/raw-scan";
import { ToolUseResults } from "../../../backends/claude-code/store/tool-use-results";

let root: string;
let path: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-cc-rawscan-")));
	path = join(root, "t.jsonl");
	writeFileSync(path, "");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const uuid = () => crypto.randomUUID();

function result(id: string, toolUseResult: unknown, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({ type: "user", message: { content: [] }, uuid: id, toolUseResult, ...extra });
}

function lineAt(span: { offset: number; length: number }): string {
	return readFileSync(path)
		.subarray(span.offset, span.offset + span.length)
		.toString("utf8");
}

describe("spans", () => {
	test("each line is found at its byte offset, across the 1 MiB reads, with multi-byte text and no final newline", async () => {
		const ids = Array.from({ length: 14 }, uuid);
		const lines = ids.map((id, n) => result(id, { text: `é漢${"x".repeat(300_000 + n)}` }));
		writeFileSync(path, lines.join("\n"));
		const { spans } = await scanRaw(path, new Set(ids));
		expect(spans.size).toBe(14);
		for (const [n, id] of ids.entries()) {
			const span = spans.get(id);
			expect(span && lineAt(span)).toBe(lines[n]);
		}
	});

	test("only chain entries are kept, and a uuid inside the toolUseResult does not take the entry's place", async () => {
		const mine = uuid();
		const other = uuid();
		const outside = uuid();
		writeFileSync(path, `${result(mine, { uuid: other })}\n${result(outside, {})}\n${result(other, { a: 1 })}\n`);
		const { spans } = await scanRaw(path, new Set([mine, other]));
		expect([...spans.keys()].sort()).toEqual([mine, other].sort());
		expect(lineAt(spans.get(mine) ?? { offset: 0, length: 0 })).toContain(`"uuid":"${mine}"`);
		expect(lineAt(spans.get(other) ?? { offset: 0, length: 0 })).toContain('{"a":1}');
	});

	test("a line past the limit is skipped without losing the lines after it or their offsets", async () => {
		const big = uuid();
		const after = uuid();
		const huge = result(big, { text: "x".repeat(MAX_RAW_LINE_BYTES + 100) });
		writeFileSync(path, `${huge}\n\n${result(after, { ok: true })}\n`);
		const { spans } = await scanRaw(path, new Set([big, after]));
		expect(spans.has(big)).toBe(false);
		const span = spans.get(after);
		expect(span && lineAt(span)).toBe(result(after, { ok: true }));
	});

	test("an entry with no uuid in the chain, a line of garbage, and a missing file give nothing and no throw", async () => {
		writeFileSync(path, `{"toolUseResult": 1}\n{"uuid":"${uuid()}","toolUseResult":{}}\nnot json "toolUseResult":\n`);
		expect((await scanRaw(path, new Set([uuid()]))).spans.size).toBe(0);
		expect(await scanRaw(join(root, "missing.jsonl"), new Set())).toBe(NO_RAW_FACTS);
	});
});

describe("system facts", () => {
	const system = (id: string, subtype: string, body: Record<string, unknown>) =>
		JSON.stringify({ type: "system", subtype, uuid: id, level: "info", isMeta: false, ...body });

	test("run boundaries, notices and compaction metadata are read for chain entries only", async () => {
		const ids = Array.from({ length: 6 }, uuid);
		const [turn, info, local, away, boundary, outside] = ids;
		writeFileSync(
			path,
			[
				system(turn ?? "", "turn_duration", { durationMs: 5 }),
				system(info ?? "", "informational", { content: "  heads up  ", level: "warning" }),
				system(local ?? "", "local_command", { content: "<local-command-stdout>printed</local-command-stdout>" }),
				system(away ?? "", "away_summary", { content: "while you were away" }),
				system(boundary ?? "", "compact_boundary", {
					compactMetadata: { trigger: "auto", preTokens: 90, postTokens: 9 },
				}),
				system(outside ?? "", "informational", { content: "not in the chain" }),
				system(uuid(), "api_error", { content: "ignored subtype" }),
			].join("\n"),
		);
		const { system: facts } = await scanRaw(path, new Set(ids.slice(0, 5)));
		expect(facts.get(turn ?? "")).toEqual({ subtype: "turn_duration", level: "info" });
		expect(facts.get(info ?? "")).toEqual({ subtype: "informational", level: "warning", text: "heads up" });
		expect(facts.get(local ?? "")).toEqual({ subtype: "local_command", level: "info", text: "printed" });
		expect(facts.get(away ?? "")).toMatchObject({ subtype: "away_summary", text: "while you were away" });
		expect(facts.get(boundary ?? "")).toMatchObject({
			boundary: { trigger: "auto", tokensBefore: 90, tokensAfter: 9 },
		});
		expect(facts.has(outside ?? "")).toBe(false);
		expect(facts.size).toBe(5);
	});

	test("the texts of old notices give way to new ones past the budget, and a huge notice line is not parsed", async () => {
		const ids = Array.from({ length: 6 }, uuid);
		const lines = ids.map((id) => system(id, "informational", { content: "y".repeat(10_000) }));
		const fat = uuid();
		lines.push(system(fat, "informational", { content: "z".repeat(70_000) }));
		for (let n = 0; n < 500; n++) {
			const id = uuid();
			ids.push(id);
			lines.push(system(id, "informational", { content: "w".repeat(10_000) }));
		}
		writeFileSync(path, lines.join("\n"));
		const { system: facts } = await scanRaw(path, new Set([...ids, fat]));
		expect(facts.has(fat)).toBe(false);
		expect(facts.has(ids.at(-1) ?? "")).toBe(true);
		expect(facts.has(ids[0] ?? "")).toBe(false);
		expect([...facts.values()].reduce((sum, fact) => sum + (fact.text?.length ?? 0), 0)).toBeLessThanOrEqual(
			4 * 1_048_576,
		);
	});
});

describe("reading a span", () => {
	test("returns the bounded toolUseResult of the right entry, and nothing for another entry, a rewritten file or a missing one", async () => {
		const id = uuid();
		const line = result(id, { stdout: "hi" });
		writeFileSync(path, `${line}\n`);
		const { spans } = await scanRaw(path, new Set([id]));
		const span = spans.get(id) ?? { offset: 0, length: 0 };
		const reader = () => new ToolUseResults(path);
		expect(await reader().read(id, span)).toEqual({ stdout: "hi" });
		expect(await reader().read(uuid(), span)).toBeUndefined();
		writeFileSync(path, `${result(uuid(), { stdout: "other" })}\n`);
		expect(await reader().read(id, span)).toBeUndefined();
		expect(await new ToolUseResults(join(root, "missing")).read(id, span)).toBeUndefined();
	});

	test("a page stops reading past its budget instead of holding more", async () => {
		const id = uuid();
		writeFileSync(path, `${result(id, { stdout: "hi" })}\n`);
		const reader = new ToolUseResults(path);
		const wide = { offset: 0, length: 40 * 1_048_576 };
		expect(await reader.read(id, wide)).toBeUndefined();
		expect(await reader.read(id, { offset: 0, length: result(id, { stdout: "hi" }).length })).toEqual({ stdout: "hi" });
	});
});
