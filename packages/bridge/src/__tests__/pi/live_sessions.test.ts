/**
 * On the real adapter: fork before and through an item, rename, delete, and the tree
 * navigation op with and without a summary, each checked against the session files on disk, which a
 * terminal `pi` reads too.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { BackendCallResult, SessionRef, TranscriptItem } from "../../contract";
import { FALLBACK_REPLY } from "./helpers/faux-router";
import { LiveRig } from "./helpers/live-rig";
import { holdingRun, userItems } from "./helpers/live-steps";
import { allItems } from "./helpers/paging";
import { findSessionFile, readEntries, sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const ids = (items: readonly TranscriptItem[]) => items.map((item) => item.id);

/** Pi names an item `<entry id>:<index>`. */
const entryIdOf = (item: TranscriptItem) => item.id.slice(0, item.id.lastIndexOf(":"));

async function twoRuns(rig: LiveRig): Promise<{ ref: SessionRef; items: TranscriptItem[] }> {
	const live = await rig.rig.openNew();
	await rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("first");
	await rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("second");
	await live.close();
	return { ref: live.ref, items: await allItems(rig.backend, live.ref, 200) };
}

async function navigate(rig: LiveRig, ref: SessionRef, itemId: string, summarize: boolean): Promise<BackendCallResult> {
	if (!rig.backend.call) throw new Error("the backend has no call()");
	return rig.backend.call({
		backend: "pi",
		op: { kind: "navigate_tree", sessionId: ref.sessionId, itemId, summarize },
	});
}

function required<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`no ${what}`);
	return value;
}

describe("fork", () => {
	test("of the whole session copies the branch; through the prompt or before the answer ends there", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "tool" });
		await live.run("Use a tool.");
		await live.close();
		const source = readFileSync(t.fileOf(live.ref));
		const items = await allItems(t.backend, live.ref, 200);
		const prompt = required(
			items.find((item) => item.kind === "user_message"),
			"prompt item",
		);
		const answer = required(
			items.find((item) => item.kind === "block"),
			"answer item",
		);

		const through = await t.backend.fork?.(live.ref, { itemId: prompt.id, position: "through" });
		const before = await t.backend.fork?.(live.ref, { itemId: answer.id, position: "before" });
		const whole = await t.backend.fork?.(live.ref, undefined);
		if (through?.status !== "accepted" || before?.status !== "accepted" || whole?.status !== "accepted") {
			throw new Error(`a fork was refused: ${JSON.stringify([through, before, whole])}`);
		}
		const backend = t.backend;
		const kindsOf = async (ref: SessionRef) => (await allItems(backend, ref, 200)).map((item) => item.kind);
		const kinds = items.map((item) => item.kind);
		expect(await kindsOf(through.session)).toEqual(kinds.slice(items.indexOf(prompt)));
		expect(await kindsOf(before.session)).toEqual(kinds.slice(items.indexOf(answer) + 1));
		expect(await kindsOf(whole.session)).toEqual(kinds);
		expect(readFileSync(t.fileOf(live.ref)).equals(source)).toBe(true);

		const header = readEntries(t.fileOf(whole.session))[0];
		expect(header).toMatchObject({ type: "session", parentSession: t.fileOf(live.ref) });
		const found = await t.backend.getSession(whole.session);
		expect(found.status === "accepted" && found.summary).toMatchObject({
			origin: "broski",
			parent: { kind: "fork", session: live.ref },
		});
		const reopened = await t.rig.open(whole.session);
		expect(reopened.session.control).toBeDefined();
		await t.rig.arrange(whole.session, { kind: "reply" });
		expect((await reopened.run("Carry on in the fork.")).outcome.kind).toBe("completed");
		expect(readFileSync(t.fileOf(live.ref)).equals(source)).toBe(true);
	});

	test("a point inside one assistant message is refused; a point between messages is not", async () => {
		t = await LiveRig.create();
		const { ref, items } = await twoRuns(t);
		const thinking = required(
			items.findLast((item) => item.kind === "block" && item.block === "thinking"),
			"thinking item",
		);
		const text = required(
			items.findLast((item) => item.kind === "block" && item.block === "text"),
			"text item",
		);
		expect(entryIdOf(thinking)).toBe(entryIdOf(text));
		for (const point of [
			{ itemId: thinking.id, position: "through" },
			{ itemId: text.id, position: "before" },
		] as const) {
			expect(await t.backend.fork?.(ref, point)).toMatchObject({
				status: "rejected",
				rejection: { code: "invalid_input" },
			});
		}
		const boundary = await t.backend.fork?.(ref, { itemId: thinking.id, position: "before" });
		expect(boundary?.status).toBe("accepted");
	});
});

describe("rename", () => {
	test.each([
		"a session nobody hosts",
		"a session with a view open",
	])("%s takes its new title, in the file and the catalog", async (kind) => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Name me.");
		if (kind === "a session nobody hosts") {
			await live.close();
			await t.bus.shutDown(live.ref.sessionId);
		}
		const title = `Renamed: ${kind}`;
		expect((await t.backend.rename?.(live.ref, title))?.status).toBe("accepted");
		await t.catalog.waitFor(
			(events) =>
				events.find(
					(event) =>
						event.type === "session_updated" &&
						event.summary.session.sessionId === live.ref.sessionId &&
						event.summary.title?.text === title,
				),
			"session_updated with the title",
		);
		const found = await t.backend.getSession(live.ref);
		expect(found.status === "accepted" && found.summary.title).toEqual({ text: title, source: "user" });
		const names = sessionEntries(t.fileOf(live.ref)).flatMap((entry) =>
			entry.type === "session_info" ? [entry.name] : [],
		);
		expect(names).toEqual([title]);
	});

	test.each([
		"a session nobody hosts",
		"a session with a view open",
	])("%s takes a title the same way: a blank one is refused, line breaks become spaces", async (kind) => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Name me.");
		if (kind === "a session nobody hosts") {
			await live.close();
			await t.bus.shutDown(live.ref.sessionId);
		}
		for (const blank of ["", "   ", "\r\n\t"]) {
			expect(await t.backend.rename?.(live.ref, blank)).toMatchObject({ rejection: { code: "invalid_input" } });
		}
		expect(await t.backend.rename?.(live.ref, "x".repeat(1_025))).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect((await t.backend.rename?.(live.ref, " two\nlines "))?.status).toBe("accepted");
		const names = sessionEntries(t.fileOf(live.ref)).flatMap((entry) =>
			entry.type === "session_info" ? [entry.name] : [],
		);
		expect(names).toEqual(["two lines"]);
	});
});

describe("delete", () => {
	test("removes the file, the listing and the session, and tells the catalog", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Delete me.");
		const file = t.fileOf(live.ref);
		expect((await t.backend.delete?.(live.ref))?.status).toBe("accepted");
		expect(t.world.trash.calls()).toEqual([file]);
		expect(t.world.trash.trashed()).toEqual([basename(file)]);
		await t.catalog.waitFor(
			(events) =>
				events.find((event) => event.type === "session_removed" && event.session.sessionId === live.ref.sessionId),
			"session_removed",
		);
		expect(findSessionFile(t.world.sessionsRoot, live.ref.sessionId)).toBeUndefined();
		expect(await t.backend.getSession(live.ref)).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect(
			await live.control.prompt({
				clientRequestId: crypto.randomUUID(),
				mode: "start",
				text: "Anyone?",
				attachments: [],
				mentions: [],
			}),
		).toMatchObject({
			status: "rejected",
			rejection: { code: "closed" },
		});
	});

	test("is refused while a run is going: busy, the file stays, the run finishes", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		expect(await t.backend.delete?.(live.ref)).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(t.world.trash.calls()).toEqual([]);
		expect(findSessionFile(t.world.sessionsRoot, live.ref.sessionId)).toBeDefined();
		t.bus.release(live.ref.sessionId);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(findSessionFile(t.world.sessionsRoot, live.ref.sessionId)).toBeDefined();
	});
});

describe("navigate_tree", () => {
	test("without a summary moves the leaf to the item, and the move survives a restart, in the file too", async () => {
		t = await LiveRig.create();
		const { ref, items } = await twoRuns(t);
		const firstAnswer = required(
			items.findLast((item) => item.kind === "block" && item.block === "text"),
			"first answer",
		);
		const keptIds = ids(items.slice(items.indexOf(firstAnswer)));

		const mark = t.catalog.items.length;
		expect(await navigate(t, ref, firstAnswer.id, false)).toMatchObject({
			status: "accepted",
			result: { kind: "navigate_tree" },
		});
		await t.catalog.waitFor(
			(events) =>
				events
					.slice(mark)
					.find((event) => event.type === "transcript_invalidated" && event.session.sessionId === ref.sessionId),
			"transcript_invalidated",
		);
		expect(ids(await allItems(t.backend, ref, 200))).toEqual(keptIds);

		const entries = sessionEntries(t.fileOf(ref));
		const byId = new Map(entries.map((entry) => [entry.id, entry]));
		const chain = new Set<string>();
		for (
			let at = entries.at(-1);
			at && !chain.has(at.id);
			at = at.parentId === null ? undefined : byId.get(at.parentId)
		)
			chain.add(at.id);
		expect(chain.has(entryIdOf(firstAnswer))).toBe(true);
		const second = required(
			items.find((item) => item.kind === "user_message"),
			"second prompt",
		);
		expect(chain.has(entryIdOf(second))).toBe(false);

		await t.rig.restart();
		expect(ids(await allItems(t.backend, ref, 200))).toEqual(keptIds);
		const reopened = await t.rig.open(ref);
		await t.rig.arrange(ref, { kind: "reply" });
		await reopened.run("third");
		expect(userItems(await allItems(t.backend, ref, 200)).map((item) => item.text)).toEqual(["third", "first"]);
	});

	test("with a summary leaves a summary of the abandoned branch in the transcript and the file", async () => {
		t = await LiveRig.create();
		const { ref, items } = await twoRuns(t);
		const firstAnswer = required(
			items.findLast((item) => item.kind === "block" && item.block === "text"),
			"first answer",
		);
		expect(await navigate(t, ref, firstAnswer.id, true)).toMatchObject({
			status: "accepted",
			result: { kind: "navigate_tree" },
		});

		const now = await allItems(t.backend, ref, 200);
		expect(now[0]?.kind).toBe("notice");
		expect(now[0]?.kind === "notice" && now[0].text).toContain(FALLBACK_REPLY);
		const summaries = sessionEntries(t.fileOf(ref)).flatMap((entry) =>
			entry.type === "branch_summary" ? [entry.summary] : [],
		);
		expect(summaries).toEqual([expect.stringContaining(FALLBACK_REPLY)]);
	});

	test("to a user message puts the leaf before it, so the transcript no longer shows the message", async () => {
		t = await LiveRig.create();
		const { ref, items } = await twoRuns(t);
		const second = required(
			items.find((item) => item.kind === "user_message"),
			"second prompt",
		);
		expect(await navigate(t, ref, second.id, false)).toMatchObject({ status: "accepted" });
		const now = await allItems(t.backend, ref, 200);
		expect(ids(now)).toEqual(ids(items.slice(items.indexOf(second) + 1)));
	});

	test("is refused while a run is going (busy), and for an item that is not there (not_found)", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("first");
		const finished = required(
			(await allItems(t.backend, live.ref, 200)).find((item) => item.kind === "block"),
			"an answer",
		);
		await t.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("second");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		expect(await navigate(t, live.ref, finished.id, false)).toMatchObject({
			status: "rejected",
			rejection: { code: "busy" },
		});
		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished");
		expect(await navigate(t, live.ref, "no-such-entry:0", false)).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
	});
});
