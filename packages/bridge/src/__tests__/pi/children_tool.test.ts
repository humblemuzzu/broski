/**
 * The children of a Pi session on a real Pi run: a tool of the user's extensions that runs a subagent and returns its
 * conversation in the result's details (the driver's `driver_subagent`) makes a child session, linked from the tool
 * call in the live stream and in the transcript, listed under its parent, readable as a transcript and followed live.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
	type AgentEvent,
	applyEvent,
	emptySnapshot,
	type SessionRef,
	type SinkRecord,
	type ToolCallItem,
	type TranscriptItem,
} from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { say, subagent } from "./helpers/scenarios";
import { conversation, writeSessionFile } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function childOf(live: LiveSession): Promise<SessionRef> {
	const linked = await live.waitFor("tool_updated", (event) => event.update.kind === "child_session");
	if (linked.update.kind !== "child_session") throw new Error("not a child link");
	return linked.update.session;
}

async function transcriptOf(rig: LiveRig, ref: SessionRef): Promise<TranscriptItem[]> {
	const items: TranscriptItem[] = [];
	let cursor: string | undefined;
	do {
		const page = await rig.backend.readTranscript(ref, { limit: 50, ...(cursor !== undefined && { cursor }) });
		if (page.status !== "accepted") throw new Error(`no transcript: ${JSON.stringify(page)}`);
		items.push(...page.page.items);
		cursor = page.page.nextCursor;
	} while (cursor !== undefined);
	return items.reverse();
}

describe("a tool that runs a subagent", () => {
	test("links its child in the live stream once, with the child's title, and the stream is valid", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		const { outcome } = await live.run("go");
		expect(outcome.kind).toBe("completed");
		const links = live
			.events()
			.filter((event) => event.type === "tool_updated" && event.update.kind === "child_session");
		expect(links).toHaveLength(1);
		const child = await t.backend.getSession(await childOf(live));
		expect(child).toMatchObject({
			status: "accepted",
			summary: {
				title: { text: "driver_subagent: Find the readme." },
				parent: { kind: "subagent", session: live.ref },
				status: "idle",
			},
		});
		live.assertSettled();
		expect(t.backend.traits.children).toBe(true);
	});

	test("is listed under its parent, not in the top level, and announced in the catalog as it appears", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		await live.run("go");
		const child = await childOf(live);
		const children = await t.backend.listSessions({ parent: live.ref }, { limit: 50 });
		expect(children.status === "accepted" && children.page.items.map((row) => row.session)).toEqual([child]);
		const top = await t.backend.listSessions({ cwd: t.cwd }, { limit: 50 });
		expect(top.status === "accepted" && top.page.items.map((row) => row.session)).toEqual([live.ref]);
		const announced = t.catalog.items.filter(
			(event) => event.type === "session_updated" && event.summary.session.sessionId === child.sessionId,
		);
		expect(announced.length).toBeGreaterThanOrEqual(2);
		const grandchildren = await t.backend.listSessions({ parent: child }, { limit: 50 });
		expect(grandchildren).toEqual({ status: "accepted", page: { items: [] } });
	});

	test("has a transcript of its own: the sub-run's messages, a call with its result, paged newest first", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		await live.run("go");
		const child = await childOf(live);
		const items = await transcriptOf(t, child);
		expect(items.map((item) => item.kind)).toEqual(["user_message", "block", "tool_call", "tool_result", "block"]);
		expect(items[0]).toMatchObject({ text: "Find the readme." });
		const call = items.find((item): item is ToolCallItem => item.kind === "tool_call");
		expect(call).toMatchObject({ name: "read", input: { path: "README.md" } });
		expect(items[3]).toMatchObject({
			toolCallId: call?.toolCallId,
			outcome: "completed",
			result: { content: [{ text: "# readme" }] },
		});
		expect(items.at(-1)).toMatchObject({ text: "found it" });
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		const first = await t.backend.readTranscript(child, { limit: 2 });
		expect(first.status === "accepted" && first.page.items).toHaveLength(2);
		expect(first.status === "accepted" && first.page.nextCursor).toBeDefined();
		expect(await t.backend.readTranscript(child, { limit: 2, cursor: "bm9wZQ" })).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
	});

	test("is linked from the parent's transcript, on the tool call", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		await live.run("go");
		const child = await childOf(live);
		const items = await transcriptOf(t, live.ref);
		const call = items.find(
			(item): item is ToolCallItem => item.kind === "tool_call" && item.name === "driver_subagent",
		);
		expect(call?.childSession).toEqual(child);
	});

	test("is followed live while its tool runs: the open snapshot holds what came before, the events the rest, and the run ends with the tool", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const gate = t.bus.newGate(live.ref.sessionId);
		t.router.script(live.ref.sessionId, [subagent("Find the readme.", gate), say("Delegated.")]);
		await live.prompt("go");
		const child = await childOf(live);

		const seen: SinkRecord[] = [];
		const opened = await t.backend.open({ kind: "existing", session: child }, { emit: (record) => seen.push(record) });
		if (opened.status !== "accepted") throw new Error(`the child did not open: ${JSON.stringify(opened)}`);
		expect(opened.session.control).toBeUndefined();
		expect(opened.snapshot.run?.items.map((item) => item.kind)).toEqual(["user_message"]);
		expect(await t.backend.readTranscript(child, { limit: 10 })).toMatchObject({
			status: "accepted",
			page: { items: [] },
		});

		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished");
		const events: AgentEvent[] = seen.map((record) => record.event);
		expect(events.map((event) => event.type)).toEqual([
			"block_started",
			"block_finished",
			"tool_started",
			"tool_finished",
			"block_started",
			"block_finished",
			"run_finished",
		]);
		const ended = seen.reduce(applyEvent, opened.snapshot);
		expect(ended.run).toBeUndefined();
		expect(opened.session.snapshot()).toEqual(ended);
		expect(emptySnapshot().run).toBeUndefined();
		expect((await transcriptOf(t, child)).length).toBe(5);
		await opened.session.close();
	});

	test("opens quietly when nobody hosts the parent, and is not found when the parent has no such call", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		await live.run("go");
		const child = await childOf(live);
		await live.close();
		const opened = await t.backend.open({ kind: "existing", session: child }, { emit: () => undefined });
		expect(opened.status).toBe("accepted");
		if (opened.status === "accepted") {
			expect(opened.session.control).toBeUndefined();
			expect(opened.snapshot.run).toBeUndefined();
		}
		const ghost = { backend: "pi" as const, sessionId: `${live.ref.sessionId}:no-such-call` };
		expect(await t.backend.getSession(ghost)).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
		expect(await t.backend.open({ kind: "existing", session: ghost }, { emit: () => undefined })).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(await t.backend.readTranscript(ghost, { limit: 5 })).toMatchObject({ status: "rejected" });
	});

	test("cannot be renamed, deleted, forked or read for attachments: it is not a file", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [subagent("Find the readme."), say("Delegated.")]);
		await live.run("go");
		const child = await childOf(live);
		expect((await t.backend.rename?.(child, "new name"))?.status).toBe("rejected");
		expect((await t.backend.delete?.(child))?.status).toBe("rejected");
		expect((await t.backend.fork?.(child, undefined))?.status).toBe("rejected");
		expect((await t.backend.readAttachment(child, "x:0")).status).toBe("rejected");
	});
});

describe("a handoff child", () => {
	test("a session that starts empty under a parent, as an extension's newSession makes it, lists as its child and reads on its own", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [say("answer")]);
		await live.run("start");
		writeSessionFile(
			t.world.sessionsRoot,
			{ id: "handoff-1", cwd: t.cwd, version: 3, parentSession: t.fileOf(live.ref) },
			conversation(["Continue with the plan.", "On it."]),
		);
		const children = await t.backend.listSessions({ parent: live.ref }, { limit: 50 });
		expect(children.status === "accepted" && children.page.items.map((row) => row.session.sessionId)).toEqual([
			"handoff-1",
		]);
		const top = await t.backend.listSessions({ cwd: t.cwd }, { limit: 50 });
		expect(top.status === "accepted" && top.page.items.map((row) => row.session.sessionId)).toContain("handoff-1");
		const read = await transcriptOf(t, { backend: "pi", sessionId: "handoff-1" });
		expect(read.map((item) => item.kind)).toEqual(["user_message", "block"]);
	});

	test("a session whose header names the parent is a child of it in the listing, as a fork is", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [say("answer")]);
		await live.run("start");
		const forked = await t.backend.fork?.(live.ref, undefined);
		if (forked?.status !== "accepted") throw new Error("no fork");
		const children = await t.backend.listSessions({ parent: live.ref }, { limit: 50 });
		expect(children.status === "accepted" && children.page.items.map((row) => [row.session, row.parent?.kind])).toEqual(
			[[forked.session, "fork"]],
		);
	});
});
