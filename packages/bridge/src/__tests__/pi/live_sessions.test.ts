/**
 * On the real adapter: fork before and through an item, rename and delete, each checked against the session files on
 * disk, which a terminal `pi` reads too.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { SessionRef, TranscriptItem } from "../../contract";
import { LiveRig } from "./helpers/live-rig";
import { holdingRun } from "./helpers/live-steps";
import { allItems } from "./helpers/paging";
import { findSessionFile, readEntries, sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

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
	test.each(["a session nobody hosts", "a session with a view open"])(
		"%s takes its new title, in the file and the catalog",
		async (kind) => {
			t = await LiveRig.create();
			const live = await t.rig.openNew();
			await t.rig.arrange(live.ref, { kind: "reply" });
			await live.run("Name me.");
			if (kind === "a session nobody hosts") {
				await live.close();
				await t.router.shutDown(live.ref.sessionId);
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
		},
	);

	test.each(["a session nobody hosts", "a session with a view open"])(
		"%s takes a title the same way: a blank one is refused, line breaks become spaces",
		async (kind) => {
			t = await LiveRig.create();
			const live = await t.rig.openNew();
			await t.rig.arrange(live.ref, { kind: "reply" });
			await live.run("Name me.");
			if (kind === "a session nobody hosts") {
				await live.close();
				await t.router.shutDown(live.ref.sessionId);
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
		},
	);
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
		t.router.release(live.ref.sessionId);
		expect((await live.waitFor("run_finished")).outcome.kind).toBe("completed");
		expect(findSessionFile(t.world.sessionsRoot, live.ref.sessionId)).toBeDefined();
	});
});
