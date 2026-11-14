/**
 * Adapter README D26 against the real CLI: Read, Edit, Write and Bash through the scripted endpoint (zero escapes).
 * What reaches the mapping's `toolResultOf` from history is the `tool_use_result` the live frame carried, and each
 * history result equals the live mapper's `tool_finished` for the same call.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE_MAPPING } from "../../../backends/claude-code/mapping";
import * as helper from "../../../backends/claude-code/mapping/tool-results";
import type { ToolFinishedEvent, TranscriptItem } from "../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../helpers/claude-home";
import { expectNoOrphans } from "../spike/rig/orphans";
import { startSpike } from "../spike/rig/session";
import { createStoreWorld, type StoreWorld } from "./helpers/store-world";

expectNoOrphans();

const CLI_TEST_MS = 60_000;
const sessionId = randomUUID();
let home: ClaudeHome;
let world: StoreWorld;
let escapes: string[] = [];
const live = new Map<string, unknown>();
let items: TranscriptItem[] = [];
const given = new Map<string, unknown>();
const finished = new Map<string, ToolFinishedEvent>();

const ids = { read: "", edit: "", write: "", bash: "" };

beforeAll(async () => {
	home = createClaudeHome();
	const file = join(home.projectDir, "a.txt");
	writeFileSync(file, "one\ntwo\nthree\n");
	const spike = startSpike({
		home,
		permissionMode: "acceptEdits",
		options: { sessionId },
		turns: [
			{ toolCalls: [{ name: "Read", args: { file_path: file } }] },
			{ toolCalls: [{ name: "Edit", args: { file_path: file, old_string: "two", new_string: "TWO" } }] },
			{ toolCalls: [{ name: "Write", args: { file_path: join(home.projectDir, "b.txt"), content: "hello\n" } }] },
			{ toolCalls: [{ name: "Bash", args: { command: "echo hi" } }] },
			{ text: ["done"] },
		],
	});
	try {
		spike.send("change things");
		await spike.waitFor((m) => m.type === "result");
	} finally {
		await spike.close();
	}
	escapes = spike.server.escapes();
	const mapper = CLAUDE_CODE_MAPPING.createMapper({ sessionId });
	const names = new Map<string, string>();
	for (const message of spike.messages) {
		for (const { event } of mapper.map(message))
			if (event.type === "tool_finished") finished.set(event.toolCallId, event);
		if (message.type === "assistant") {
			for (const block of message.message.content) if (block.type === "tool_use") names.set(block.id, block.name);
		}
		if (message.type === "user" && message.tool_use_result !== undefined && Array.isArray(message.message.content)) {
			const block = message.message.content.find((part) => part.type === "tool_result");
			if (block !== undefined) live.set(block.tool_use_id, message.tool_use_result);
		}
	}
	for (const [id, name] of names) {
		if (name === "Read") ids.read = id;
		if (name === "Edit") ids.edit = id;
		if (name === "Write") ids.write = id;
		if (name === "Bash") ids.bash = id;
	}
	world = await createStoreWorld(home);
	const spy = spyOn(helper, "toolResultOf");
	try {
		let cursor: string | undefined;
		do {
			const page = await world.store.transcript(
				sessionId,
				{ limit: 100, ...(cursor !== undefined && { cursor }) },
				world.live,
			);
			if (page.status !== "accepted") throw new Error(page.rejection.message);
			items.push(...page.page.items);
			cursor = page.page.nextCursor;
		} while (cursor !== undefined);
		for (const [block, toolUseResult] of spy.mock.calls) {
			const id = typeof block === "object" && block !== null && "tool_use_id" in block ? String(block.tool_use_id) : "";
			given.set(id, toolUseResult);
		}
	} finally {
		spy.mockRestore();
	}
}, CLI_TEST_MS);

afterAll(async () => {
	await world?.dispose();
	home?.cleanup();
	items = [];
});

describe("tool results the real CLI wrote", () => {
	test("the run stayed on the scripted endpoint, and the CLI's live frames carry a result per tool", () => {
		expect(escapes).toEqual([]);
		for (const id of Object.values(ids)) expect(id).not.toBe("");
		expect(live.get(ids.edit)).toMatchObject({
			oldString: "two",
			newString: "TWO",
			structuredPatch: [{ lines: expect.any(Array) }],
		});
	});

	test("history hands the helper the very value the live frame carried, for Read, Edit, Write and Bash", () => {
		for (const id of [ids.read, ids.edit, ids.write, ids.bash]) {
			expect(given.get(id)).toEqual(live.get(id));
			expect(given.get(id)).not.toBeUndefined();
		}
		expect(given.get(ids.edit)).toMatchObject({ filePath: realpathSync(join(home.projectDir, "a.txt")) });
	});

	test("each result is a tool_result item with the live id, next to its call", () => {
		const resultIds = items.filter((item) => item.kind === "tool_result").map((item) => item.id);
		expect(resultIds).toEqual([ids.bash, ids.write, ids.edit, ids.read].map((id) => `${id}:result`));
	});

	test("the Edit result carries its diff, the Write its new file, the Bash its output", () => {
		const result = (id: string) => items.find((item) => item.kind === "tool_result" && item.toolCallId === id);
		const edit = result(ids.edit);
		const changes = edit?.kind === "tool_result" ? edit.result.fileChanges : [];
		expect(changes[0]).toMatchObject({ change: "modified" });
		expect(changes[0]?.path).toContain("a.txt");
		expect(changes[0]?.diff).toContain("+TWO");
		const write = result(ids.write);
		expect(write?.kind === "tool_result" && write.result.fileChanges[0]).toMatchObject({ change: "added" });
		const bash = result(ids.bash);
		expect(JSON.stringify(bash?.kind === "tool_result" ? bash.result.content : [])).toContain("hi");
	});

	test("each history result equals what the live mapper finished the call with", () => {
		for (const id of [ids.read, ids.edit, ids.write, ids.bash]) {
			const item = items.find((entry) => entry.kind === "tool_result" && entry.toolCallId === id);
			const live = finished.get(id);
			expect(live).toBeDefined();
			const stored = item?.kind === "tool_result" ? { outcome: item.outcome, result: item.result } : undefined;
			expect(stored).toEqual(live && { outcome: live.outcome, result: live.result });
		}
	});
});
