/** the entries that are not a turn: shell commands, extension messages, summaries, compactions, model changes, bookkeeping. */

import { describe, expect, test } from "bun:test";
import { BASE, ENTRY_MS, fileEntry, mapEntry, messageEntry, REQUEST_ID } from "./mapping_fixtures";

const map = mapEntry;

describe("notices", () => {
	test("a user shell command: the command, its output without escapes, how it ended", () => {
		const bash = (extra: Record<string, unknown>) =>
			messageEntry("b1", {
				role: "bashExecution",
				command: "ls",
				output: "\u001b[1mfile\u001b[0m",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 1,
				...extra,
			});
		expect(map(bash({}))).toEqual([
			{ kind: "tool_call", id: "b1:0", at: ENTRY_MS, toolCallId: "b1:0", name: "bash", input: { command: "ls" } },
			{
				kind: "tool_result",
				id: "b1:1",
				at: ENTRY_MS,
				toolCallId: "b1:0",
				outcome: "completed",
				result: { content: [{ kind: "text", text: "file" }], fileChanges: [], exitCode: 0 },
			},
		]);
		expect(map(bash({ exitCode: 2, output: "" }))[1]).toMatchObject({
			outcome: "failed",
			result: { content: [], error: "Command exited with code 2", exitCode: 2 },
		});
		expect(map(bash({ cancelled: true, exitCode: undefined }))[1]).toMatchObject({
			outcome: "aborted",
			result: { content: [{ kind: "text", text: "file" }] },
		});
		expect(map(bash({ truncated: true, fullOutputPath: "/tmp/full" }))[1]).toMatchObject({
			result: { content: [{ kind: "text", text: "file\n[Output truncated. Full output: /tmp/full]" }] },
		});
		expect(map(bash({ excludeFromContext: true }))[0]).toMatchObject({
			input: { command: "ls", excludeFromContext: true },
		});
	});

	test("an extension's message is shown only when it asks to, as its text", () => {
		const custom = (display: boolean, content: unknown) => ({
			...BASE,
			type: "custom_message" as const,
			id: "m1",
			customType: "x",
			display,
			content: content as string,
		});
		expect(map(custom(true, "\u001b[32mhello\u001b[0m"))).toEqual([
			{ kind: "notice", id: "m1:0", at: ENTRY_MS, level: "info", text: "hello" },
		]);
		expect(
			map(
				custom(true, [
					{ type: "text", text: "a" },
					{ type: "image", data: "A", mimeType: "image/png" },
					{ type: "text", text: "b" },
				]),
			),
		).toMatchObject([{ text: "a\nb" }]);
		expect(map(custom(false, "hidden"))).toEqual([]);
		expect(map(custom(true, [{ type: "image", data: "A", mimeType: "image/png" }]))).toEqual([]);
		expect(
			map(messageEntry("m2", { role: "custom", customType: "x", content: "shown", display: true, timestamp: 1 })),
		).toMatchObject([{ kind: "notice", text: "shown" }]);
	});

	test("a branch summary is a labelled notice", () => {
		const summary = { ...BASE, type: "branch_summary" as const, id: "s1", fromId: "e0", summary: "did things" };
		expect(map(summary)).toEqual([
			{ kind: "notice", id: "s1:0", at: ENTRY_MS, level: "info", text: "Branch summary:\ndid things" },
		]);
	});
});

describe("session bookkeeping entries", () => {
	test("a compaction keeps its summary and the tokens it replaced", () => {
		const compaction = {
			...BASE,
			type: "compaction" as const,
			id: "c1",
			summary: "so far",
			firstKeptEntryId: "e0",
			tokensBefore: 12_000,
		};
		expect(map(compaction)).toEqual([
			{ kind: "compaction", id: "c1:0", at: ENTRY_MS, summary: "so far", tokensBefore: 12_000 },
		]);
		expect(map({ ...compaction, tokensBefore: -1 })).toEqual([
			{ kind: "compaction", id: "c1:0", at: ENTRY_MS, summary: "so far" },
		]);
	});

	test("a model change names the wire id, which is never split, and a thinking change only the level", () => {
		const change = {
			...BASE,
			type: "model_change" as const,
			id: "m1",
			provider: "openrouter",
			modelId: "anthropic/claude",
		};
		expect(map(change)).toEqual([
			{ kind: "model_change", id: "m1:0", at: ENTRY_MS, modelId: "openrouter/anthropic/claude" },
		]);
		expect(map({ ...change, modelId: "m".repeat(300) })).toEqual([]);
		expect(map({ ...BASE, type: "thinking_level_change", id: "t1", thinkingLevel: "high" })).toEqual([
			{ kind: "model_change", id: "t1:0", at: ENTRY_MS, thinking: "high" },
		]);
	});

	test("a summary or level missing from a hand-edited file leaves the item without it, or gives none", () => {
		const branch = { ...BASE, type: "branch_summary" as const, id: "s1", fromId: "e0" };
		expect(map({ ...branch, summary: "" })).toEqual([]);
		expect(map(JSON.parse(JSON.stringify(branch)))).toEqual([]);
		const compaction = JSON.parse(
			'{"type":"compaction","id":"c1","parentId":null,"timestamp":"2026-01-02T03:04:05.000Z","firstKeptEntryId":"e0","tokensBefore":5}',
		);
		expect(map(compaction)).toEqual([{ kind: "compaction", id: "c1:0", at: ENTRY_MS, tokensBefore: 5 }]);
		const thinking = JSON.parse(
			'{"type":"thinking_level_change","id":"t1","parentId":null,"timestamp":"2026-01-02T03:04:05.000Z"}',
		);
		expect(map(thinking)).toEqual([]);
	});

	test("system messages, never-stored roles and bookkeeping give nothing (an unknown entry never leaves the store)", () => {
		const entries = [
			messageEntry("s1", { role: "system", content: "prompt", timestamp: 1 }),
			messageEntry("s2", { role: "branchSummary", summary: "x", fromId: null, timestamp: 1 }),
			messageEntry("s3", { role: "compactionSummary", summary: "x", tokensBefore: 1, timestamp: 1 }),
			{
				...BASE,
				type: "custom",
				id: "k1",
				customType: "broski.prompt",
				data: { clientRequestId: REQUEST_ID, imageNames: [] },
			},
			{ ...BASE, type: "label", id: "k2", targetId: "e1", label: "mark" },
			{ ...BASE, type: "session_info", id: "k3", name: "Title" },
			{
				...BASE,
				type: "usage",
				id: "k4",
				kind: "cache_warm",
				provider: "p",
				model: "m",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
			},
			{ ...BASE, type: "context_edit", id: "k5", targetId: "e1", replacement: null },
		];
		for (const entry of entries) expect(map(fileEntry(entry))).toEqual([]);
	});
});
