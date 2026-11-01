/**
 * The live events protocol 1.4 added, as the core sends them: a client of this minor gets them as they are, and a
 * client of an older minor gets a stand-in at the same place in the stream (contract README §12.4).
 */

import { describe, expect, test } from "bun:test";
import { MAX_TEXT_CHARS, type ProtocolVersion, type SessionRef } from "../contract";
import type { FakeStep } from "../contract/testing/fake-script";
import { quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const MINOR_THREE = { major: 1, minor: 3 } as const;
const MINOR_ONE = { major: 1, minor: 1 } as const;

async function ranWith(steps: FakeStep[], protocol?: ProtocolVersion) {
	const rig = await startCoreRig();
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, steps);
	const phone = await rig.client("phone", protocol);
	await phone.ok("session.attach", { session });
	await phone.ok("prompt", {
		session,
		input: { clientRequestId: crypto.randomUUID(), mode: "start", text: "go", attachments: [], mentions: [] },
	});
	await quiesce();
	return { rig, session, phone };
}

const suggesting = (text: string): FakeStep[] => [
	{ kind: "text", text: "Done." },
	{ kind: "extension", extension: { kind: "prompt_suggestion", text } },
];

function seqOf(client: TestClient, session: SessionRef, type: string): number | undefined {
	return client.envelopes(session).find((envelope) => envelope.event.type === type)?.seq;
}

describe("a prompt suggestion", () => {
	test("reaches a client of this minor as the extension", async () => {
		const { rig, session, phone } = await ranWith(suggesting("Run the tests"));
		expect(phone.events(session).find((event) => event.type === "extension")).toEqual({
			type: "extension",
			extension: { kind: "prompt_suggestion", text: "Run the tests" },
		});
		expect([...phone.violations, ...rig.log.errors]).toEqual([]);
	});

	test("reaches an older client as a notice with its text, at the same place in the stream", async () => {
		const modern = await ranWith(suggesting("Run the tests"));
		for (const protocol of [MINOR_THREE, MINOR_ONE]) {
			const older = await ranWith(suggesting("Run the tests"), protocol);
			const events = older.phone.events(older.session);
			expect(events.some((event) => event.type === "extension")).toBe(false);
			expect(events.find((event) => event.type === "notice")).toEqual({
				type: "notice",
				level: "info",
				text: "Suggested next prompt: Run the tests",
			});
			expect(seqOf(older.phone, older.session, "notice")).toBe(seqOf(modern.phone, modern.session, "extension"));
			expect([...older.phone.violations, ...older.rig.log.errors]).toEqual([]);
		}
	});

	test("as a notice is cut to the contract's bound between characters, never inside one", async () => {
		const heading = "Suggested next prompt: ";
		const split = `${"a".repeat(MAX_TEXT_CHARS - heading.length - 1)}😀`;
		const older = await ranWith(suggesting(split), MINOR_THREE);
		const notice = older.phone.events(older.session).find((event) => event.type === "notice");
		const text = notice?.type === "notice" ? notice.text : "";
		expect(text).toBe(`${heading}${"a".repeat(MAX_TEXT_CHARS - heading.length - 1)}`);
		expect(older.phone.violations).toEqual([]);
	});
});
