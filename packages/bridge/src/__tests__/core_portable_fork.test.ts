import { describe, expect, test } from "bun:test";
import type { BackendTraits, SessionRef, TranscriptItem } from "../contract";
import { NO_METHODS } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { MAX_HANDOFF_CHARS } from "../core/portable-fork";
import { type CoreRig, promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const START_ONLY: BackendTraits = { ...FULL_TRAITS, promptModes: ["start"], queue: false };

async function noFork(portableFork: boolean) {
	const rig = await startCoreRig({
		fake: { traits: START_ONLY, methods: NO_METHODS },
		core: { fallbacks: { portableFork } },
	});
	const phone = await rig.client("phone");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	return { rig, phone, session };
}

async function items(phone: TestClient, session: SessionRef): Promise<TranscriptItem[]> {
	const read = await phone.ok("transcript.read", { session, page: { limit: 200 } });
	if (read.result.status !== "accepted") throw new Error("the transcript could not be read");
	return read.result.page.items;
}

async function forked(phone: TestClient, session: SessionRef, at?: { itemId: string; position: "before" | "through" }) {
	const answer = await phone.ok("session.fork", { session, ...(at && { at }) });
	if (answer.result.status !== "accepted") throw new Error(`the fork was refused: ${JSON.stringify(answer.result)}`);
	return answer.result.session;
}

async function firstPrompts(rig: CoreRig, phone: TestClient, session: SessionRef): Promise<string[]> {
	await phone.ok("session.attach", { session });
	const sent: string[] = [];
	for (const text of ["Go on", "And then"]) {
		await phone.ok("prompt", { session, input: promptInput(text) });
		await quiesce();
		sent.push(rig.fake.fake.delivered(session)?.text ?? "");
	}
	return sent;
}

describe("a fork for a backend that cannot fork", () => {
	test("is off unless asked for", async () => {
		const { phone, session } = await noFork(false);
		const answer = await phone.ok("session.fork", { session });
		expect(answer.result).toMatchObject({ rejection: { code: "unsupported" } });
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities.fork).toBe(false);
	});

	test("opens a session in the same folder whose first prompt alone carries the conversation", async () => {
		const { rig, phone, session } = await noFork(true);
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities.fork).toBe(true);
		const fork = await forked(phone, session);
		expect(fork.sessionId).not.toBe(session.sessionId);
		const row = await phone.ok("session.get", { session: fork });
		expect(row.result).toMatchObject({ status: "accepted", summary: { cwd: RIG_CWD } });
		const [first, second] = await firstPrompts(rig, phone, fork);
		expect(first).toBe(
			"<broski_context_handoff>\nThis conversation goes on from another session. Its newest part, oldest first:\nUser: Hello\nAssistant: Hi.\n</broski_context_handoff>\n\nGo on",
		);
		expect(second).toBe("And then");
	});

	test("stops at the fork point, and refuses one the transcript does not have", async () => {
		const { rig, phone, session } = await noFork(true);
		const reply = (await items(phone, session)).find((item) => item.kind === "block");
		if (!reply) throw new Error("the seeded session has no reply");
		const fork = await forked(phone, session, { itemId: reply.id, position: "before" });
		const [first] = await firstPrompts(rig, phone, fork);
		expect(first).toContain("User: Hello");
		expect(first).not.toContain("Assistant: Hi.");
		const missing = await phone.ok("session.fork", { session, at: { itemId: "nope", position: "through" } });
		expect(missing.result).toMatchObject({ rejection: { code: "not_found" } });
	});

	test("keeps the newest messages within its bound", async () => {
		const { rig, phone, session } = await noFork(true);
		await phone.ok("session.attach", { session });
		for (const letter of ["a", "b", "c"]) {
			rig.fake.fake.script(session, [{ kind: "text", text: letter.repeat(30_000) }]);
			await phone.ok("prompt", { session, input: promptInput(`Write ${letter}`) });
			await quiesce();
		}
		const [first] = await firstPrompts(rig, phone, await forked(phone, session));
		const handoff = first?.slice(0, first.indexOf("\n\nGo on")) ?? "";
		expect(handoff.length).toBeLessThanOrEqual(MAX_HANDOFF_CHARS);
		expect(handoff).toContain(`User: Write c\nAssistant: ${"c".repeat(30_000)}\n</broski_context_handoff>`);
		expect(handoff).not.toContain("Write a");
	});

	test("a backend that forks itself is never stood in for", async () => {
		const rig = await startCoreRig({ core: { fallbacks: { portableFork: true } } });
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const [first] = await firstPrompts(rig, phone, await forked(phone, session));
		expect(first).toBe("Go on");
	});
});

describe("a backend that takes the person's words alone (verbatimPrompts)", () => {
	test("is offered no portable fork, and its queued and steered prompts reach it exactly as sent", async () => {
		const rig = await startCoreRig({
			fake: { traits: { ...START_ONLY, verbatimPrompts: true }, methods: NO_METHODS },
			core: { fallbacks: { queue: true, steer: true, portableFork: true } },
		});
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities).toMatchObject({ promptModes: ["start", "steer", "queue"], queue: true, fork: false });
		expect(backend?.capabilities).not.toHaveProperty("verbatimPrompts");
		expect((await phone.ok("session.fork", { session })).result).toMatchObject({ rejection: { code: "unsupported" } });

		rig.fake.fake.script(session, [{ kind: "text", text: "Working." }, { kind: "hold" }]);
		await phone.ok("session.attach", { session });
		for (const [text, mode] of [
			["First", "start"],
			["Queued", "queue"],
			["Steered", "steer"],
		] as const) {
			await phone.ok("prompt", { session, input: promptInput(text, mode) });
			await quiesce();
		}
		rig.fake.fake.release(session);
		await quiesce();
		const delivered = phone.events(session).flatMap((event) => (event.type === "user_message" ? [event.text] : []));
		expect(delivered).toEqual(["First", "Steered", "Queued"]);
	});
});
