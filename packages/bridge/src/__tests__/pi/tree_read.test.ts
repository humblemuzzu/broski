/**
 * `read_tree` on real Pi sessions: a hosted one with branches and labels, a stored one nobody hosts, a big
 * file read page by page, and the refusals.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { TREE_PREVIEW_CHARS } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { callPi, treeOf, wholeTree } from "./helpers/pi-calls";
import { say } from "./helpers/scenarios";
import { conversation, messageEntry, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("the tree of a hosted session", () => {
	test("holds every message newest first, each under its parent, with the leaf and the terminal's text", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [say("first answer"), say("second answer")]);
		await live.run("one");
		await live.run("two\nlines");
		const tree = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 50 } }),
		);
		const messages = tree.nodes.filter((node) => node.kind === "user" || node.kind === "assistant");
		expect(messages.map((node) => [node.kind, node.preview])).toEqual([
			["assistant", "second answer"],
			["user", "two\nlines"],
			["assistant", "first answer"],
			["user", "one"],
		]);
		const byId = new Map(tree.nodes.map((node) => [node.id, node]));
		for (const node of tree.nodes) if (node.parentId !== undefined) expect(byId.has(node.parentId)).toBe(true);
		const roots = tree.nodes.filter((node) => node.parentId === undefined);
		expect(roots.length).toBeGreaterThan(0);
		expect(tree.leafId).toBe(messages[0]?.id);
		expect(tree.total).toBe(tree.nodes.length);
		expect(tree.nextCursor).toBeUndefined();
		for (const node of tree.nodes) expect(node.itemId).toBe(`${node.id}:0`);
	});

	test("shows both branches once the session moved back and went another way, the leaf on the new one", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [say("first answer"), say("second answer"), say("a different answer")]);
		await live.run("one");
		await live.run("two");
		const before = await wholeTree(t.backend, live.ref.sessionId);
		const firstAnswer = before.find((node) => node.preview === "first answer");
		expect(firstAnswer).toBeDefined();
		const moved = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: firstAnswer?.itemId ?? "",
			summarize: false,
		});
		expect(moved.status).toBe("accepted");
		await live.run("three");
		const after = await wholeTree(t.backend, live.ref.sessionId);
		const byId = new Map(after.map((node) => [node.id, node]));
		const ancestors = (id: string): string[] => {
			const chain: string[] = [];
			for (let at = byId.get(id)?.parentId; at !== undefined; at = byId.get(at)?.parentId) chain.push(at);
			return chain;
		};
		const three = after.find((node) => node.preview === "three");
		const two = after.find((node) => node.preview === "two");
		expect(ancestors(three?.id ?? "")).toContain(firstAnswer?.id ?? "none");
		expect(ancestors(two?.id ?? "")).toContain(firstAnswer?.id ?? "none");
		expect(ancestors(three?.id ?? "")).not.toContain(two?.id ?? "none");
		const latest = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 1 } }),
		);
		expect(latest.leafId).toBe(latest.nodes[0]?.id);
		expect(latest.nodes[0]?.preview).toBe("a different answer");
	});
});

describe("the tree of a session nobody hosts", () => {
	test("is read from the file: branches, a label that was set then cleared, a label that stands, and the leaf", async () => {
		t = await LiveRig.create();
		const entries = [
			...conversation(["question", "answer"]),
			messageEntry("e3", "e2", "user", "left branch"),
			messageEntry("e4", "e2", "user", "right branch"),
			{
				type: "label",
				id: "l1",
				parentId: "e4",
				timestamp: "2026-01-01T00:00:01.000Z",
				targetId: "e2",
				label: "first",
			},
			{ type: "label", id: "l2", parentId: "l1", timestamp: "2026-01-01T00:00:02.000Z", targetId: "e2", label: "kept" },
			{ type: "label", id: "l3", parentId: "l2", timestamp: "2026-01-01T00:00:03.000Z", targetId: "e3", label: "gone" },
			{ type: "label", id: "l4", parentId: "l3", timestamp: "2026-01-01T00:00:04.000Z", targetId: "e3" },
			{
				type: "usage",
				id: "u1",
				parentId: "l4",
				timestamp: "2026-01-01T00:00:05.000Z",
				kind: "x",
				provider: "p",
				model: "m",
				usage: {},
			},
			messageEntry("e5", "u1", "assistant", "after the usage entry"),
		];
		writeSessionFile(t.world.sessionsRoot, { id: "stored-1", cwd: t.cwd, version: 3 }, entries);
		const nodes = await wholeTree(t.backend, "stored-1");
		const byId = new Map(nodes.map((node) => [node.id, node]));
		expect(byId.get("e2")?.label).toBe("kept");
		expect(byId.get("e3")?.label).toBeUndefined();
		expect(byId.has("u1")).toBe(false);
		expect(byId.get("e5")?.parentId).toBe("l4");
		expect(byId.get("e3")?.parentId).toBe("e2");
		expect(byId.get("e4")?.parentId).toBe("e2");
		expect(byId.get("e1")?.parentId).toBeUndefined();
		const head = treeOf(await callPi(t.backend, { kind: "read_tree", sessionId: "stored-1", page: { limit: 1 } }));
		expect(head.leafId).toBe("e5");
		expect(head.total).toBe(9);
	});

	test("cuts a long text and says so, and leaves a short one whole", async () => {
		t = await LiveRig.create();
		const long = "x".repeat(TREE_PREVIEW_CHARS + 50);
		writeSessionFile(t.world.sessionsRoot, { id: "stored-2", cwd: t.cwd, version: 3 }, conversation([long, "short"]));
		const nodes = await wholeTree(t.backend, "stored-2");
		const cut = nodes.find((node) => node.kind === "user");
		expect(cut?.preview).toHaveLength(TREE_PREVIEW_CHARS);
		expect(cut?.previewCut).toBe(true);
		expect(nodes.find((node) => node.kind === "assistant")?.previewCut).toBe(false);
	});
});

describe("a big tree", () => {
	test("is read a page at a time: every node once, newest first, the total on each page", async () => {
		t = await LiveRig.create();
		const turns = Array.from({ length: 450 }, (_, index) => `turn ${index}`);
		writeSessionFile(t.world.sessionsRoot, { id: "big", cwd: t.cwd, version: 3 }, conversation(turns));
		const first = treeOf(await callPi(t.backend, { kind: "read_tree", sessionId: "big", page: { limit: 200 } }));
		expect(first.nodes).toHaveLength(200);
		expect(first.total).toBe(450);
		expect(first.nextCursor).toBeDefined();
		const all = await wholeTree(t.backend, "big", 200);
		expect(all).toHaveLength(450);
		expect(new Set(all.map((node) => node.id)).size).toBe(450);
		expect(all[0]?.preview).toBe("turn 449");
		expect(all.at(-1)?.preview).toBe("turn 0");
	});

	test("refuses a cursor it did not mint and one the file has outgrown", async () => {
		t = await LiveRig.create();
		writeSessionFile(t.world.sessionsRoot, { id: "small", cwd: t.cwd, version: 3 }, conversation(["a", "b", "c", "d"]));
		const foreign = await callPi(t.backend, {
			kind: "read_tree",
			sessionId: "small",
			page: { limit: 2, cursor: "bm9wZQ" },
		});
		expect(foreign).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		const one = treeOf(await callPi(t.backend, { kind: "read_tree", sessionId: "small", page: { limit: 2 } }));
		const other = writeSessionFile(
			t.world.sessionsRoot,
			{ id: "other", cwd: t.cwd, version: 3 },
			conversation(["a", "b", "c", "d"]),
		);
		expect(other).toContain("other");
		const crossed = await callPi(t.backend, {
			kind: "read_tree",
			sessionId: "other",
			page: { limit: 2, cursor: one.nextCursor ?? "" },
		});
		expect(crossed).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
	});

	test("an unknown session is not found", async () => {
		t = await LiveRig.create();
		const result = await callPi(t.backend, { kind: "read_tree", sessionId: "nowhere", page: { limit: 5 } });
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});
});
