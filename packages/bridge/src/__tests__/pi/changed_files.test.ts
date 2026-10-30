/**
 * `changed_files`: the files a session's tool calls changed, each once, with the lines added and removed across all its
 * edits, read from a real run and from a file a terminal wrote.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { MAX_LIST_ITEMS } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { say, toolUse } from "./helpers/scenarios";
import { accepted, callPi } from "./helpers/transfer-calls";
import { useWatchdog } from "./helpers/use-watchdog";
import { SessionBuilder, textBlock, toolCall, writeSession } from "./store_fixtures";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("the files a session changed", () => {
	test("are the files a real run wrote and edited, folded per file with the lines added and removed", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [
			toolUse(fauxToolCall("write", { path: "a.txt", content: "one\ntwo\nthree\n" })),
			toolUse(fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "two", newText: "2" }] })),
			toolUse(fauxToolCall("write", { path: "b.txt", content: "only line" })),
			toolUse(fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "not in the file", newText: "x" }] })),
			say("Done."),
		]);
		const mark = live.recorder.items.length;
		await live.prompt("make the files");
		await live.runAfter(mark);
		await t.driver.quiesce();

		const read = accepted(
			await callPi(t.backend, { kind: "changed_files", sessionId: live.ref.sessionId }),
			"changed_files",
		);
		expect(read).toEqual({
			kind: "changed_files",
			files: [
				{ path: "a.txt", change: "modified", additions: 4, deletions: 1 },
				{ path: "b.txt", change: "modified", additions: 1 },
			],
			omitted: 0,
			additions: 5,
			deletions: 1,
		});
	});

	test("are none for a session that changed nothing", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [say("Nothing to change.")]);
		const mark = live.recorder.items.length;
		await live.prompt("just talk");
		await live.runAfter(mark);
		const read = accepted(
			await callPi(t.backend, { kind: "changed_files", sessionId: live.ref.sessionId }),
			"changed_files",
		);
		expect(read).toEqual({ kind: "changed_files", files: [], omitted: 0, additions: 0, deletions: 0 });
	});

	test("are read from a file a terminal wrote, an edit by its patch", async () => {
		t = await LiveRig.create();
		const builder = new SessionBuilder({ id: "terminal", cwd: t.cwd, version: 3 });
		builder.user("change it", 10);
		builder.assistant([textBlock("on it"), toolCall("t1", "edit", { path: "src/main.ts" })], 20);
		builder.raw({
			type: "message",
			id: "r1",
			parentId: "e0000002",
			timestamp: "2026-03-01T10:00:00.030Z",
			message: {
				role: "toolResult",
				toolCallId: "t1",
				toolName: "edit",
				content: [{ type: "text", text: "edited" }],
				details: { patch: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,4 @@\n a\n-b\n-c\n+B\n+C\n+D\n e\n" },
				isError: false,
				timestamp: 1,
			},
		});
		writeSession(t.world.sessionsRoot, builder);

		const read = accepted(await callPi(t.backend, { kind: "changed_files", sessionId: "terminal" }), "changed_files");
		expect(read.files).toEqual([{ path: "src/main.ts", change: "modified", additions: 3, deletions: 2 }]);
		expect([read.additions, read.deletions]).toEqual([3, 2]);
	});

	test("are listed up to the contract's bound, and the files past it are counted in `omitted`", async () => {
		t = await LiveRig.create();
		const builder = new SessionBuilder({ id: "many", cwd: t.cwd, version: 3 });
		builder.user("write many", 10);
		const files = MAX_LIST_ITEMS + 100;
		for (let from = 0; from < files; from += 100) {
			const calls = Array.from({ length: Math.min(100, files - from) }, (_, index) =>
				toolCall(`t${from + index}`, "write", { path: `f${from + index}.txt`, content: "x\n" }),
			);
			builder.assistant(calls, 20 + from);
			for (let index = 0; index < calls.length; index++) {
				builder.toolResult(`t${from + index}`, "wrote", 30 + from + index, "write");
			}
		}
		writeSession(t.world.sessionsRoot, builder);

		const read = accepted(await callPi(t.backend, { kind: "changed_files", sessionId: "many" }), "changed_files");
		expect(read.files).toHaveLength(MAX_LIST_ITEMS);
		expect(read.omitted).toBe(100);
		expect(read.additions).toBe(files);
	});

	test("an unknown session is not found", async () => {
		t = await LiveRig.create();
		expect(await callPi(t.backend, { kind: "changed_files", sessionId: "nobody" })).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
	});
});
