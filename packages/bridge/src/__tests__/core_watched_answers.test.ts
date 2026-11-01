/**
 * Answering a session that can only be watched (core README §21): a session without control whose adapter offers
 * `OpenSession.answer` takes answers to its asks, from a phone viewing it and from outside the phones, through the
 * desk; every other request on it stays refused, and a client below 1.4 is told and allowed nothing new.
 */

import { describe, expect, test } from "bun:test";
import type { AgentBackend, Interaction, InteractionAnswer, SessionRef } from "../contract";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { changedSession, recordingAnswers, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const PERMISSION = [
	{ kind: "tool" as const, name: "bash", input: { command: "ls" }, output: "ok", permission: true },
	{ kind: "text" as const, text: "Ran it." },
];
const MINOR_THREE = { major: 1, minor: 3 } as const;

function allow(interaction: Interaction): InteractionAnswer {
	return { interactionId: interaction.id, reply: { kind: "tool_permission", optionId: "allow_once", grantIds: [] } };
}

function offTheList(interaction: Interaction): InteractionAnswer {
	return { interactionId: interaction.id, reply: { kind: "tool_permission", optionId: "no-such", grantIds: [] } };
}

async function watchedRig(adapt?: (backend: AgentBackend) => AgentBackend) {
	const seen: InteractionAnswer[] = [];
	const rig = await startCoreRig({
		adapt: (backend) => recordingAnswers(adapt ? adapt(backend) : backend, seen),
	});
	const session = rig.fake.fake.seed({ cwd: RIG_CWD, external: true, answerable: true });
	rig.fake.fake.runExternally(session, "From the terminal.", PERMISSION);
	await quiesce();
	return { rig, session, seen };
}

async function pendingFor(phone: TestClient, session: SessionRef): Promise<Interaction> {
	const attached = await phone.ok("session.attach", { session });
	if (attached.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
	const [interaction] = attached.sync.snapshot.interactions;
	if (!interaction) throw new Error("nothing was asked");
	return interaction;
}

const codeOf = (result: { status: string; rejection?: { code: string } }) => result.rejection?.code ?? result.status;

describe("a session that can only be watched but takes answers", () => {
	test("tells a phone viewing it so, and the phone's answer goes through the desk once", async () => {
		const { rig, session, seen } = await watchedRig();
		const phone = await rig.client("phone");
		const attached = await phone.ok("session.attach", { session });
		expect(attached.capabilities).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			cancelCompaction: false,
			cancelRetry: false,
			answer: true,
		});
		const interaction = await pendingFor(phone, session);
		const bad = await phone.ok("interaction.answer", { session, answer: offTheList(interaction) });
		expect(codeOf(bad.result)).toBe("invalid_input");
		expect(seen).toEqual([]);
		const good = await phone.ok("interaction.answer", { session, answer: allow(interaction) });
		expect(good.result).toEqual({ status: "accepted" });
		await quiesce();
		expect(phone.events(session).some((event) => event.type === "interaction_resolved")).toBe(true);
		const again = await phone.ok("interaction.answer", { session, answer: allow(interaction) });
		expect(codeOf(again.result)).toBe("stale");
		expect(seen).toEqual([allow(interaction)]);
		expect(rig.log.errors).toEqual([]);
	});

	test("refuses every other request on it, as before", async () => {
		const { rig, session } = await watchedRig();
		const phone = await rig.client("phone");
		await phone.ok("session.attach", { session });
		const results = [
			(await phone.ok("prompt", { session, input: promptInput("x") })).result,
			(await phone.ok("abort", { session })).result,
			(await phone.ok("queue.cancel", { session, queueItemId: "q" })).result,
			(await phone.ok("model.set", { session, modelId: "fake-small" })).result,
			(await phone.ok("thinking.set", { session, thinking: "high" })).result,
			(await phone.ok("mode.set", { session, axis: "permissions", value: "edits" })).result,
			(await phone.ok("compact", { session })).result,
			(await phone.ok("compaction.cancel", { session })).result,
			(await phone.ok("retry.cancel", { session })).result,
		];
		expect(results.map(codeOf)).toEqual(Array(results.length).fill("unsupported"));
	});

	test("takes no answer from a phone that does not view it", async () => {
		const { rig, session, seen } = await watchedRig();
		const viewer = await rig.client("viewer");
		const interaction = await pendingFor(viewer, session);
		const other = await rig.client("other");
		const answered = await other.request("interaction.answer", { session, answer: allow(interaction) });
		expect(answered).toMatchObject({ error: { code: "not_attached" } });
		expect(seen).toEqual([]);
	});

	test("tells a client of 1.3 nothing of it and refuses its answer as before", async () => {
		const { rig, session, seen } = await watchedRig();
		const older = await rig.client("older", MINOR_THREE);
		const attached = await older.ok("session.attach", { session });
		expect(Object.keys(attached.capabilities).sort()).toEqual([
			"cancelCompaction",
			"cancelQueued",
			"cancelRetry",
			"compact",
			"controllable",
		]);
		if (attached.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
		const [interaction] = attached.sync.snapshot.interactions;
		if (!interaction) throw new Error("nothing was asked");
		const answered = await older.ok("interaction.answer", { session, answer: allow(interaction) });
		expect(codeOf(answered.result)).toBe("unsupported");
		expect(seen).toEqual([]);
	});

	test("takes an answer from outside the phones while held with no viewer, checked, first one winning", async () => {
		const { rig, session, seen } = await watchedRig();
		expect(await rig.core.hold(session)).toEqual({ status: "accepted" });
		const phone = await rig.client("phone");
		const interaction = await pendingFor(phone, session);
		await phone.ok("session.detach", { session });
		expect(codeOf(await rig.core.answer(session, offTheList(interaction)))).toBe("invalid_input");
		expect(seen).toEqual([]);
		await phone.ok("session.attach", { session });
		const [fromPhone, fromBridge] = await Promise.all([
			phone.ok("interaction.answer", { session, answer: allow(interaction) }),
			rig.core.answer(session, allow(interaction)),
		]);
		expect([codeOf(fromPhone.result), codeOf(fromBridge)].sort()).toEqual(["accepted", "stale"]);
		expect(seen).toHaveLength(1);
		await phone.ok("session.detach", { session });
		rig.core.release(session);
		await quiesce();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("keeps its ask, and itself open, with no hold and no viewer until someone answers", async () => {
		const { rig, session, seen } = await watchedRig();
		const phone = await rig.client("phone");
		const interaction = await pendingFor(phone, session);
		await phone.ok("session.detach", { session });
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		expect(seen).toEqual([]);
		expect(await rig.core.answer(session, allow(interaction))).toEqual({ status: "accepted" });
	});
});

describe("a session with control that also offers its own answer", () => {
	test("is answered through its control, from a phone and from outside the phones", async () => {
		const own: InteractionAnswer[] = [];
		const offering = (backend: AgentBackend): AgentBackend =>
			wrappingSessions(backend, (open) => ({
				...changedSession(open, {}),
				answer: async (answer: InteractionAnswer) => {
					own.push(answer);
					return { status: "accepted" };
				},
			}));
		const seen: InteractionAnswer[] = [];
		const rig = await startCoreRig({ adapt: (backend) => offering(recordingAnswers(backend, seen)) });
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [...PERMISSION, ...PERMISSION]);
		const phone = await rig.client("phone");
		const attached = await phone.ok("session.attach", { session });
		expect(attached.capabilities).toMatchObject({ controllable: true, answer: true });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const asked = phone.events(session).filter((event) => event.type === "interaction_requested");
		const first = asked[0]?.type === "interaction_requested" ? asked[0].interaction : undefined;
		if (!first) throw new Error("nothing was asked");
		expect((await phone.ok("interaction.answer", { session, answer: allow(first) })).result.status).toBe("accepted");
		await quiesce();
		const next = phone.events(session).filter((event) => event.type === "interaction_requested")[1];
		if (next?.type !== "interaction_requested") throw new Error("the second ask did not come");
		expect(await rig.core.answer(session, allow(next.interaction))).toEqual({ status: "accepted" });
		expect(seen).toEqual([allow(first), allow(next.interaction)]);
		expect(own).toEqual([]);
	});
});
