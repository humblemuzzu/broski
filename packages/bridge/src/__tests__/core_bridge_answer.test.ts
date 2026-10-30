import { describe, expect, test } from "bun:test";
import type { AgentBackend, Interaction, InteractionAnswer, SessionRef } from "../contract";
import { REQUEST_DEADLINE_MS } from "../core/protocol-server";
import { changedSession, Gate, recordingAnswers, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const PERMISSION = [
	{ kind: "tool" as const, name: "bash", input: { command: "ls" }, output: "ok", permission: true },
	{ kind: "text" as const, text: "Ran it." },
];

function pending(phone: TestClient, session: SessionRef): Interaction {
	const asked = phone.events(session).find((event) => event.type === "interaction_requested");
	if (asked?.type !== "interaction_requested") throw new Error("nothing was asked");
	return asked.interaction;
}

function allow(interaction: Interaction): InteractionAnswer {
	return {
		interactionId: interaction.id,
		reply: { kind: "tool_permission", optionId: "allow_once", grantIds: [] },
	};
}

async function askedRig(adapt?: (backend: AgentBackend) => AgentBackend) {
	const rig = await startCoreRig(adapt ? { adapt } : {});
	const phone = await rig.client("a");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, PERMISSION);
	await phone.ok("session.attach", { session });
	await phone.ok("prompt", { session, input: promptInput("Go") });
	await quiesce();
	return { rig, phone, session, interaction: pending(phone, session) };
}

describe("an answer from outside the attached phones", () => {
	test("it reaches the adapter once, checked like a phone's, and the run goes on", async () => {
		const seen: InteractionAnswer[] = [];
		const { rig, phone, session, interaction } = await askedRig((backend) => recordingAnswers(backend, seen));
		await phone.ok("session.detach", { session });
		expect(await rig.core.answer(session, allow(interaction))).toEqual({ status: "accepted" });
		await quiesce();
		expect(seen).toEqual([allow(interaction)]);
		expect(await rig.core.answer(session, allow(interaction))).toMatchObject({ rejection: { code: "stale" } });
		expect(seen).toHaveLength(1);
		expect(rig.log.errors).toEqual([]);
	});

	test("an answer that is no answer to the interaction never reaches the adapter", async () => {
		const seen: InteractionAnswer[] = [];
		const { rig, session, interaction } = await askedRig((backend) => recordingAnswers(backend, seen));
		const wrong = { interactionId: interaction.id, reply: { kind: "confirm" as const, confirmed: true } };
		expect(await rig.core.answer(session, wrong)).toMatchObject({ rejection: { code: "invalid_input" } });
		const unknownOption = {
			interactionId: interaction.id,
			reply: { kind: "tool_permission" as const, optionId: "no-such-option", grantIds: [] },
		};
		expect(await rig.core.answer(session, unknownOption)).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(seen).toEqual([]);
	});

	test("an interaction nobody asked is not found, and a session that is not open has nothing to answer", async () => {
		const { rig, session, interaction } = await askedRig();
		const nobody = { ...allow(interaction), interactionId: "nobody-asked" };
		expect(await rig.core.answer(session, nobody)).toMatchObject({ rejection: { code: "not_found" } });
		const closed = rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(await rig.core.answer(closed, allow(interaction))).toMatchObject({
			rejection: { code: "not_found", message: "the session is not open" },
		});
	});

	test("a first answer racing a phone's: exactly one is accepted and the adapter sees one", async () => {
		const seen: InteractionAnswer[] = [];
		const { rig, phone, session, interaction } = await askedRig((backend) => recordingAnswers(backend, seen));
		const [fromPhone, fromBridge] = await Promise.all([
			phone.ok("interaction.answer", { session, answer: allow(interaction) }),
			rig.core.answer(session, allow(interaction)),
		]);
		const results = [fromPhone.result.status, fromBridge.status].sort();
		expect(results).toEqual(["accepted", "rejected"]);
		expect(seen).toHaveLength(1);
	});

	test("a session that can only be watched answers unsupported", async () => {
		const watching = (backend: AgentBackend): AgentBackend =>
			wrappingSessions(backend, (open) => {
				const { control: _control, ...rest } = changedSession(open, {});
				return rest;
			});
		const rig = await startCoreRig({ adapt: watching });
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		rig.fake.fake.runExternally(session, "From the terminal", PERMISSION);
		await quiesce();
		const interaction = pending(phone, session);
		expect(await rig.core.answer(session, allow(interaction))).toMatchObject({ rejection: { code: "unsupported" } });
	});

	test("an adapter that throws is a backend_error and logged; one that never answers is given up on at the deadline", async () => {
		const gate = new Gate<never>();
		let mode: "throw" | "wedge" = "throw";
		const breaking = (backend: AgentBackend): AgentBackend =>
			wrappingSessions(backend, (open) =>
				changedSession(open, {
					control: (control) => ({
						...control,
						answer: async () => {
							if (mode === "throw") throw new Error("kaput");
							return gate.hold();
						},
					}),
				}),
			);
		const { rig, session, interaction } = await askedRig(breaking);
		expect(await rig.core.answer(session, allow(interaction))).toMatchObject({ rejection: { code: "backend_error" } });
		expect(rig.log.errors.some((line) => line.includes("answering threw"))).toBe(true);

		mode = "wedge";
		const waiting = rig.core.answer(session, allow(interaction));
		await gate.arrived();
		rig.clock.advance(REQUEST_DEADLINE_MS);
		expect(await waiting).toMatchObject({ rejection: { code: "backend_error" } });
		expect(rig.log.errors.some((line) => line.includes("did not take an answer within"))).toBe(true);
	});
});
