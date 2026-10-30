/**
 * The tree ops on real Pi sessions: navigating to any node of the file, with and without a summary, cancelling a
 * summary that is being written, and setting and clearing labels. Each leaves the file as Pi's own session manager
 * would, and every refusal leaves it as it was.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { SessionRef } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { callPi, treeOf, wholeTree } from "./helpers/pi-calls";
import { say } from "./helpers/scenarios";
import { conversation, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function twoExchanges(rig: LiveRig): Promise<LiveSession> {
	const live = await rig.rig.openNew();
	rig.router.script(live.ref.sessionId, [say("first answer"), say("second answer")]);
	await live.run("one");
	await live.run("two");
	return live;
}

async function nodeNamed(rig: LiveRig, session: SessionRef, preview: string) {
	const node = (await wholeTree(rig.backend, session.sessionId)).find((candidate) => candidate.preview === preview);
	if (node === undefined) throw new Error(`no node reads ${preview}`);
	return node;
}

describe("navigating to any node of the tree", () => {
	test("a node on the way back, on the branch the transcript shows, moves the leaf and the tree follows", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		const moved = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: target.itemId,
			summarize: false,
		});
		expect(moved).toEqual({ status: "accepted", result: { kind: "navigate_tree" } });
		const tree = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 1 } }),
		);
		expect(tree.nodes[0]).toMatchObject({ kind: "label", parentId: target.id });
		expect(tree.leafId).toBe(tree.nodes[0]?.id);
	});

	test("a node of a branch the session has left is reached too, though the transcript no longer holds it", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const left = await nodeNamed(t, live.ref, "second answer");
		await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: (await nodeNamed(t, live.ref, "first answer")).itemId,
			summarize: false,
		});
		const back = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: left.itemId,
			summarize: false,
		});
		expect(back).toMatchObject({ status: "accepted" });
		const tree = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 1 } }),
		);
		expect(tree.nodes[0]).toMatchObject({ kind: "label", parentId: left.id });
	});

	test("a user message puts the leaf on its parent, as the terminal's tree does", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const user = await nodeNamed(t, live.ref, "two");
		const answerBefore = await nodeNamed(t, live.ref, "first answer");
		await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: user.itemId,
			summarize: false,
		});
		const tree = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 1 } }),
		);
		expect(tree.nodes[0]?.parentId).toBe(user.parentId);
		expect(user.parentId).toBeDefined();
		expect(answerBefore.id).toBeDefined();
	});

	test("an entry the file does not hold, and an item that names no entry, are not found", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const file = readFileSync(t.fileOf(live.ref), "utf8");
		for (const itemId of ["nothing:0", "not-an-item-id"]) {
			const result = await callPi(t.backend, {
				kind: "navigate_tree",
				sessionId: live.ref.sessionId,
				itemId,
				summarize: false,
			});
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		}
		expect(readFileSync(t.fileOf(live.ref), "utf8")).toBe(file);
	});

	test("instructions without a summary are refused", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		const result = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: target.itemId,
			summarize: false,
			instructions: "focus on the files",
		});
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
	});

	test("a session another client wrote cannot be moved, though its tree reads", async () => {
		t = await LiveRig.create();
		writeSessionFile(t.world.sessionsRoot, { id: "terminal-made", cwd: t.cwd, version: 3 }, conversation(["a", "b"]));
		const nodes = await wholeTree(t.backend, "terminal-made");
		const result = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: "terminal-made",
			itemId: nodes[1]?.itemId ?? "",
			summarize: false,
		});
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
	});
});

describe("a branch summary", () => {
	test("is written with the instructions asked for, and the move shows as a summary node", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		t.router.scriptUnkeyed([say("The other branch asked a second question.")]);
		const result = await callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: target.itemId,
			summarize: true,
			instructions: "stress the questions",
		});
		expect(result).toMatchObject({ status: "accepted" });
		const request = t.router.unkeyedRequests().at(-1);
		expect(JSON.stringify(request?.messages)).toContain("stress the questions");
		const head = treeOf(
			await callPi(t.backend, { kind: "read_tree", sessionId: live.ref.sessionId, page: { limit: 1 } }),
		);
		expect(head.nodes[0]).toMatchObject({ kind: "branch_summary", parentId: target.id });
	});

	test("that is being written can be cancelled: the move is refused, the file is as it was, the session is free again", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		const file = readFileSync(t.fileOf(live.ref), "utf8");
		const entered = Promise.withResolvers<void>();
		t.router.scriptUnkeyed([
			async (_context, options) => {
				entered.resolve();
				await new Promise<void>((resolve) =>
					options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
				return fauxAssistantMessage("", { stopReason: "aborted" });
			},
		]);
		const navigating = callPi(t.backend, {
			kind: "navigate_tree",
			sessionId: live.ref.sessionId,
			itemId: target.itemId,
			summarize: true,
		});
		await entered.promise;
		const cancelled = await callPi(t.backend, { kind: "abort_branch_summary", sessionId: live.ref.sessionId });
		expect(cancelled).toEqual({ status: "accepted", result: { kind: "abort_branch_summary" } });
		expect(await navigating).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(readFileSync(t.fileOf(live.ref), "utf8")).toBe(file);
		t.router.script(live.ref.sessionId, [say("third answer")]);
		expect((await live.run("three")).outcome.kind).toBe("completed");
	});

	test("cancelling when nothing is being summarised is accepted and does nothing, and a session that does not exist is not found", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const file = readFileSync(t.fileOf(live.ref), "utf8");
		expect(await callPi(t.backend, { kind: "abort_branch_summary", sessionId: live.ref.sessionId })).toMatchObject({
			status: "accepted",
		});
		await live.close();
		expect(await callPi(t.backend, { kind: "abort_branch_summary", sessionId: live.ref.sessionId })).toMatchObject({
			status: "accepted",
		});
		expect(await callPi(t.backend, { kind: "abort_branch_summary", sessionId: "nobody" })).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(readFileSync(t.fileOf(live.ref), "utf8")).toBe(file);
	});
});

describe("labels", () => {
	test("are set and cleared through the session, and the tree shows them", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		const set = await callPi(t.backend, {
			kind: "label_entry",
			sessionId: live.ref.sessionId,
			entryId: target.id,
			label: "  checkpoint  ",
		});
		expect(set).toEqual({ status: "accepted", result: { kind: "label_entry" } });
		expect((await nodeNamed(t, live.ref, "first answer")).label).toBe("checkpoint");
		await callPi(t.backend, { kind: "label_entry", sessionId: live.ref.sessionId, entryId: target.id });
		expect((await nodeNamed(t, live.ref, "first answer")).label).toBeUndefined();
		await callPi(t.backend, { kind: "label_entry", sessionId: live.ref.sessionId, entryId: target.id, label: "again" });
		await callPi(t.backend, { kind: "label_entry", sessionId: live.ref.sessionId, entryId: target.id, label: "   " });
		expect((await nodeNamed(t, live.ref, "first answer")).label).toBeUndefined();
	});

	test("are set on a session nobody has open, which is hosted for the write and let go", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		await live.close();
		const set = await callPi(t.backend, {
			kind: "label_entry",
			sessionId: live.ref.sessionId,
			entryId: target.id,
			label: "later",
		});
		expect(set).toMatchObject({ status: "accepted" });
		expect((await nodeNamed(t, live.ref, "first answer")).label).toBe("later");
	});

	test("are refused for an entry the session does not hold, and for a session another client wrote", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const file = readFileSync(t.fileOf(live.ref), "utf8");
		expect(
			await callPi(t.backend, { kind: "label_entry", sessionId: live.ref.sessionId, entryId: "nope", label: "x" }),
		).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(readFileSync(t.fileOf(live.ref), "utf8")).toBe(file);
		writeSessionFile(t.world.sessionsRoot, { id: "terminal-made", cwd: t.cwd, version: 3 }, conversation(["a", "b"]));
		expect(
			await callPi(t.backend, { kind: "label_entry", sessionId: "terminal-made", entryId: "e1", label: "x" }),
		).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
	});

	test("are refused while the session runs", async () => {
		t = await LiveRig.create();
		const live = await twoExchanges(t);
		const target = await nodeNamed(t, live.ref, "first answer");
		await t.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("hold on");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		const result = await callPi(t.backend, {
			kind: "label_entry",
			sessionId: live.ref.sessionId,
			entryId: target.id,
			label: "mid-run",
		});
		expect(result).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		await live.control.abort();
	});
});
