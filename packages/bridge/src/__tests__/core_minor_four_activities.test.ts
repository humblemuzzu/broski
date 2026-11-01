/**
 * A harness activity (protocol 1.4), as the core serves it: a client of this minor gets the `activity` event, the
 * run's activity items in a snapshot and the transcript's; a client of an older minor gets a notice in each place,
 * with the event's `seq` and the item's id (contract README §12.4).
 */

import { describe, expect, test } from "bun:test";
import type { Activity, ProtocolVersion, SessionRef, TranscriptItem } from "../contract";
import type { FakeStep } from "../contract/testing/fake-script";
import { quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const MINOR_THREE = { major: 1, minor: 3 } as const;

const started: Activity = { id: "hook-1", label: "PreToolUse:Read", detail: "PreToolUse", status: "running" };
const ended: Activity = { ...started, status: "failed", output: "no access", durationMs: 7 };
const steps = (hold: boolean): FakeStep[] => [
	{ kind: "activity", activity: started },
	{ kind: "activity", activity: ended },
	{ kind: "text", text: "Done." },
	...(hold ? [{ kind: "hold" } as const] : []),
];

async function ranWith(protocol?: ProtocolVersion, hold = false) {
	const rig = await startCoreRig();
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, steps(hold));
	const phone = await rig.client("phone", protocol);
	await phone.ok("session.attach", { session });
	await phone.ok("prompt", {
		session,
		input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [], mentions: [] },
	});
	await quiesce();
	return { rig, session, phone };
}

function seqsOf(client: TestClient, session: SessionRef, type: string): number[] {
	return client
		.envelopes(session)
		.filter((envelope) => envelope.event.type === type)
		.map((envelope) => envelope.seq);
}

const olderItem = {
	kind: "notice",
	id: "hook-1",
	level: "warning",
	text: "PreToolUse:Read (PreToolUse): failed in 7 ms\n\nno access",
};

describe("a harness activity", () => {
	test("reaches a client of this minor as the event, replaced by its id", async () => {
		const { rig, session, phone } = await ranWith();
		const activities = phone.events(session).flatMap((event) => (event.type === "activity" ? [event.activity] : []));
		expect(activities).toEqual([started, ended]);
		expect([...phone.violations, ...rig.log.errors]).toEqual([]);
	});

	test("reaches an older client as notices at the same places in the stream", async () => {
		const modern = await ranWith();
		const older = await ranWith(MINOR_THREE);
		const notices = older.phone.events(older.session).filter((event) => event.type === "notice");
		expect(notices).toEqual([
			{ type: "notice", level: "info", text: "PreToolUse:Read (PreToolUse): running" },
			{ type: "notice", level: "warning", text: olderItem.text },
		]);
		expect(seqsOf(older.phone, older.session, "notice")).toEqual(seqsOf(modern.phone, modern.session, "activity"));
		expect([...older.phone.violations, ...older.rig.log.errors]).toEqual([]);
	});

	test("is one item in the run of a snapshot; an older client reads it as a notice item", async () => {
		const { rig, session } = await ranWith(undefined, true);
		const itemOf = async (client: TestClient) => {
			const attached = await client.ok("session.attach", { session });
			const run = attached.sync.kind === "snapshot" ? attached.sync.snapshot.run : undefined;
			return run?.items.filter((item) => item.id === "hook-1");
		};
		expect(await itemOf(await rig.client("modern"))).toEqual([expect.objectContaining({ kind: "activity", ...ended })]);
		const older = await rig.client("older", MINOR_THREE);
		expect(await itemOf(older)).toEqual([expect.objectContaining(olderItem)]);
		expect(older.violations).toEqual([]);
	});

	test("in the transcript reaches an older client as a notice item", async () => {
		const { rig, session } = await ranWith();
		const read = async (client: TestClient): Promise<TranscriptItem[]> => {
			const page = await client.ok("transcript.read", { session, page: { limit: 50 } });
			return page.result.status === "accepted" ? page.result.page.items.filter((item) => item.id === "hook-1") : [];
		};
		expect(await read(await rig.client("modern"))).toEqual([expect.objectContaining({ kind: "activity", ...ended })]);
		const older = await rig.client("older", MINOR_THREE);
		expect(await read(older)).toEqual([expect.objectContaining(olderItem)]);
		expect(older.violations).toEqual([]);
	});
});
