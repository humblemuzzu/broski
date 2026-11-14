/**
 * Adapter README D26: a history tool result reaches the mapping's `toolResultOf` with the entry's `toolUseResult` from
 * the raw file, the value the live frame carried. The helper is spied on, not replaced: its answer is whatever the
 * mapping built.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { isRecord } from "../../../backends/claude-code/json";
import * as helper from "../../../backends/claude-code/mapping/tool-results";
import { MAX_LIST_ITEMS, MAX_TEXT_CHARS } from "../../../contract";
import { frameScenarios, readFrameFixture } from "../helpers/frame-fixtures";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";
import { TranscriptBuilder } from "./helpers/transcript-builder";

let world: StoreWorld;
beforeEach(async () => {
	world = await createStoreWorld();
});
afterEach(async () => {
	await world.dispose();
});

interface Received {
	readonly toolUseId: string;
	readonly toolUseResult: unknown;
	readonly toolName: string | undefined;
	readonly entryUuid: string;
	readonly blockIndex: number;
}

/** Reads the whole transcript in pages of `limit` and returns what `toolResultOf` was given, by tool call. */
async function received(sessionId: string, limit = 200): Promise<Map<string, Received>> {
	const spy = spyOn(helper, "toolResultOf");
	try {
		let cursor: string | undefined;
		do {
			const page = await world.store.transcript(
				sessionId,
				{ limit, ...(cursor !== undefined && { cursor }) },
				world.live,
			);
			if (page.status !== "accepted") throw new Error(page.rejection.message);
			cursor = page.page.nextCursor;
		} while (cursor !== undefined);
		const calls = new Map<string, Received>();
		for (const [block, toolUseResult, place, toolName] of spy.mock.calls) {
			const toolUseId = isRecord(block) && typeof block.tool_use_id === "string" ? block.tool_use_id : "";
			calls.set(toolUseId, { toolUseId, toolUseResult, toolName, ...place });
		}
		return calls;
	} finally {
		spy.mockRestore();
	}
}

const EDIT = {
	filePath: "/p/a.ts",
	oldString: "two",
	newString: "TWO",
	originalFile: "one\ntwo\nthree\n",
	structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" one", "-two", "+TWO", " three"] }],
	userModified: false,
	replaceAll: false,
};
const WRITE = {
	type: "create",
	filePath: "/p/b.ts",
	content: "hello\n",
	structuredPatch: [],
	originalFile: null,
	userModified: false,
};
const MULTI = {
	filePath: "/p/c.ts",
	edits: [{ old_string: "a", new_string: "b" }],
	originalFile: "a\n",
	structuredPatch: EDIT.structuredPatch,
	userModified: false,
};
const NOTEBOOK = {
	new_source: "x = 1",
	cell_id: "c1",
	cell_type: "code",
	language: "python",
	edit_mode: "replace",
	error: "",
	notebook_path: "/p/n.ipynb",
	original_file: "{}",
	updated_file: "{}",
};
const BASH = { stdout: "hi", stderr: "", interrupted: false, isImage: false, noOutputExpected: false };

function toolSession(name: string) {
	const sessionId = crypto.randomUUID();
	const b = new TranscriptBuilder(sessionId, world.project(name));
	b.user("change things");
	const results: Record<string, string> = {};
	const call = (id: string, tool: string, input: unknown, output: unknown, toolUseResult?: unknown) => {
		b.toolUse(`msg_${id}`, id, tool, input);
		results[id] = b.toolResult(id, output, toolUseResult);
	};
	call("toolu_edit", "Edit", { file_path: "/p/a.ts" }, "updated", EDIT);
	call("toolu_write", "Write", { file_path: "/p/b.ts" }, "created", WRITE);
	call("toolu_multi", "MultiEdit", { file_path: "/p/c.ts" }, "edited", MULTI);
	call("toolu_nb", "NotebookEdit", { notebook_path: "/p/n.ipynb" }, "edited", NOTEBOOK);
	call("toolu_bash", "Bash", { command: "echo hi" }, "hi", BASH);
	call("toolu_fail", "Bash", { command: "false" }, "Exit code 1", "Error: Exit code 1");
	call("toolu_plain", "Read", { file_path: "/p/d" }, "text");
	const built = b.write(world.home.configDir);
	return { built, results };
}

describe("what reaches toolResultOf", () => {
	test("each result gets its entry's toolUseResult, its tool's name and its place", async () => {
		const { built, results } = toolSession("results");
		const got = await received(built.sessionId);
		expect(got.get("toolu_edit")?.toolUseResult).toEqual(EDIT);
		expect(got.get("toolu_write")?.toolUseResult).toEqual(WRITE);
		expect(got.get("toolu_multi")?.toolUseResult).toEqual(MULTI);
		expect(got.get("toolu_nb")?.toolUseResult).toEqual(NOTEBOOK);
		expect(got.get("toolu_bash")?.toolUseResult).toEqual(BASH);
		expect(got.get("toolu_fail")?.toolUseResult).toBe("Error: Exit code 1");
		expect(got.get("toolu_plain")?.toolUseResult).toBeUndefined();
		expect([...got.values()].map((r) => r.toolName)).toEqual(
			["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "Bash", "Read"].reverse(),
		);
		for (const [id, entryUuid] of Object.entries(results)) {
			expect(got.get(id)).toMatchObject({ entryUuid, blockIndex: 0 });
		}
	});

	test("the same values arrive whatever the page size, and on a second read of the unchanged file", async () => {
		const { built } = toolSession("pages");
		const whole = await received(built.sessionId);
		for (const limit of [1, 2, 3]) expect(await received(built.sessionId, limit)).toEqual(whole);
		expect(await received(built.sessionId)).toEqual(whole);
	});

	test("a value is bounded before the helper sees it, and an oversize line is left out", async () => {
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, world.project("bounded"));
		b.user("big");
		b.toolUse("msg_1", "toolu_big", "Read", {});
		b.toolResult("toolu_big", "ok", {
			content: "é".repeat(MAX_TEXT_CHARS + 10),
			lines: Array.from({ length: MAX_LIST_ITEMS + 50 }, (_, n) => n),
		});
		b.toolUse("msg_2", "toolu_huge", "Read", {});
		b.toolResult("toolu_huge", "ok", { content: "x".repeat(9 * 1_048_576) });
		b.write(world.home.configDir);
		const got = await received(sessionId);
		const big = got.get("toolu_big")?.toolUseResult as { content: string; lines: number[] };
		expect(big.content.length).toBe(MAX_TEXT_CHARS);
		expect(big.lines).toHaveLength(MAX_LIST_ITEMS);
		expect(got.get("toolu_huge")?.toolUseResult).toBeUndefined();
	});

	test("an entry that answers two calls gets none, since its toolUseResult would belong to one of them", async () => {
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, world.project("parallel"));
		b.user("two at once");
		b.toolUse("msg_p", "toolu_a", "Bash", {});
		b.toolUse("msg_p", "toolu_b", "Bash", {});
		b.userBlocks([
			{ type: "tool_result", tool_use_id: "toolu_a", content: "a" },
			{ type: "tool_result", tool_use_id: "toolu_b", content: "b" },
		]);
		const built = b.write(world.home.configDir);
		const lines = (await Bun.file(built.path).text())
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line));
		lines[lines.length - 1].toolUseResult = [BASH, BASH];
		await Bun.write(built.path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
		const got = await received(sessionId);
		expect([...got.keys()].sort()).toEqual(["toolu_a", "toolu_b"]);
		expect(got.get("toolu_a")?.toolUseResult).toBeUndefined();
		expect(got.get("toolu_b")?.toolUseResult).toBeUndefined();
	});

	test("an entry the SDK's chain leaves out is not read (before a compaction)", async () => {
		const sessionId = crypto.randomUUID();
		const b = new TranscriptBuilder(sessionId, world.project("compacted-results"));
		b.user("before");
		b.toolUse("msg_1", "toolu_old", "Bash", {});
		b.toolResult("toolu_old", "old", BASH);
		b.compaction("Summary of the above.");
		b.user("after");
		b.toolUse("msg_2", "toolu_new", "Bash", {});
		b.toolResult("toolu_new", "new", BASH);
		b.write(world.home.configDir);
		const got = await received(sessionId);
		expect([...got.keys()]).toEqual(["toolu_new"]);
		expect(got.get("toolu_new")?.toolUseResult).toEqual(BASH);
	});
});

describe("equal to the live frames", () => {
	const live = frameScenarios().flatMap((scenario) => {
		const frames = readFrameFixture(scenario);
		const names = new Map<string, { name: string; input: unknown }>();
		const results: { id: string; output: unknown; toolUseResult: unknown; name: string; input: unknown }[] = [];
		for (const frame of frames) {
			if (frame.type === "assistant") {
				for (const block of frame.message.content) {
					if (block.type === "tool_use") names.set(block.id, { name: block.name, input: block.input });
				}
			}
			if (frame.type === "user" && Array.isArray(frame.message.content) && frame.tool_use_result !== undefined) {
				const block = frame.message.content.find((part) => part.type === "tool_result");
				const call = block === undefined ? undefined : names.get(block.tool_use_id);
				if (block !== undefined && call !== undefined)
					results.push({ id: block.tool_use_id, output: block.content, toolUseResult: frame.tool_use_result, ...call });
			}
		}
		return results.map((result) => ({ scenario, ...result }));
	});

	test("the recorded frames hold results of Read, Write and Bash to compare with", () => {
		for (const name of ["Read", "Write", "Bash"]) expect(live.some((result) => result.name === name)).toBe(true);
	});

	test("every recorded tool result, written as the CLI writes it, reaches the helper as the live frame carried it", async () => {
		const unique = new Map(live.map((result) => [`${result.scenario}:${result.id}`, result]));
		for (const [key, result] of unique) {
			const sessionId = crypto.randomUUID();
			const b = new TranscriptBuilder(sessionId, world.project(`frame-${key.replace(/\W/g, "-")}`));
			b.user("replay");
			b.toolUse("msg_f", result.id, result.name, result.input);
			b.toolResult(result.id, result.output, result.toolUseResult);
			b.write(world.home.configDir);
			const got = await received(sessionId);
			expect({ key, value: got.get(result.id)?.toolUseResult }).toEqual({
				key,
				value: JSON.parse(JSON.stringify(result.toolUseResult)),
			});
			expect(got.get(result.id)?.toolName).toBe(result.name);
		}
		expect(unique.size).toBeGreaterThan(10);
	});
});
