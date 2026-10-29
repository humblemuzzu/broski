import { describe, expect, test } from "bun:test";
import type { ActionResult, AgentBackend, Interaction, InteractionAnswer, SessionRef, SessionSink } from "../contract";
import { invalidReplies, validReply } from "../contract/testing/example-replies";
import type { FakeStep } from "../contract/testing/fake-script";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { changedSession, Gate, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const CONFIRM: FakeStep[] = [
	{ kind: "ask", title: "Go on?", request: { kind: "confirm" } },
	{ kind: "text", text: "Went on." },
];

/** The interaction the client saw requested and not yet resolved. */
function pending(client: TestClient, session: SessionRef): Interaction {
	const events = client.events(session);
	const resolved = new Set(
		events.flatMap((event) => (event.type === "interaction_resolved" ? [event.interactionId] : [])),
	);
	const open = events.flatMap((event) =>
		event.type === "interaction_requested" && !resolved.has(event.interaction.id) ? [event.interaction] : [],
	);
	const [interaction] = open;
	if (!interaction || open.length !== 1) throw new Error(`expected one pending interaction, saw ${open.length}`);
	return interaction;
}

describe("the interactions desk", () => {
	test("the first answer wins: the other phone sees the resolution, and its answer is stale", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await b.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(b, session);
		const answer = { interactionId: interaction.id, reply: validReply(interaction) };
		expect((await a.ok("interaction.answer", { session, answer })).result).toEqual({ status: "accepted" });
		expect(b.events(session)).toContainEqual({
			type: "interaction_resolved",
			interactionId: interaction.id,
			reason: "answered",
		});
		expect((await b.ok("interaction.answer", { session, answer })).result).toMatchObject({
			rejection: { code: "stale" },
		});
		await quiesce();
		expect(a.events(session).at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
	});

	test("answers sent at once from two phones: exactly one is accepted", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await b.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		const answer = { interactionId: interaction.id, reply: validReply(interaction) };
		const results = await Promise.all([
			a.ok("interaction.answer", { session, answer }),
			b.ok("interaction.answer", { session, answer }),
		]);
		expect(
			results.map(({ result }) => (result.status === "accepted" ? "accepted" : result.rejection.code)).sort(),
		).toEqual(["accepted", "stale"]);
	});

	test("an invalid answer is refused before any adapter sees it and changes nothing; an unknown interaction is not_found", async () => {
		const reached: InteractionAnswer[] = [];
		const rig = await startCoreRig({ adapt: recordingAnswers(reached) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [
			{ kind: "tool", name: "write", input: { path: "a.txt" }, output: "written", permission: true },
		]);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Write") });
		await quiesce();
		const interaction = pending(a, session);
		const seen = a.events(session).length;
		for (const reply of invalidReplies(interaction)) {
			const result = (await a.ok("interaction.answer", { session, answer: { interactionId: interaction.id, reply } }))
				.result;
			expect(result).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
		}
		const unknown = await a.ok("interaction.answer", {
			session,
			answer: { interactionId: "no-such-ask", reply: { kind: "cancel", stopRun: false } },
		});
		expect(unknown.result).toMatchObject({ rejection: { code: "not_found" } });
		await quiesce();
		expect(a.events(session)).toHaveLength(seen);
		expect(pending(a, session).id).toBe(interaction.id);
		expect(reached).toEqual([]);
	});

	test("an answer on its way makes another stale; one the adapter refuses frees the interaction", async () => {
		const gate = answerGate();
		const rig = await startCoreRig({ adapt: gate.adapt });
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await b.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		const answer = { interactionId: interaction.id, reply: validReply(interaction) };
		const first = a.ok("interaction.answer", { session, answer });
		await gate.arrived();
		expect((await b.ok("interaction.answer", { session, answer })).result).toMatchObject({
			rejection: { code: "stale", message: expect.stringContaining("on its way") },
		});
		gate.refuseNext();
		expect((await first).result).toMatchObject({ rejection: { code: "backend_error" } });
		const retry = b.ok("interaction.answer", { session, answer });
		await gate.arrived();
		gate.passNext();
		expect((await retry).result).toEqual({ status: "accepted" });
	});

	test("an answer on its way still holds its interaction after the session goes on under a new id", async () => {
		const gate = answerGate();
		const rig = await startCoreRig({ adapt: gate.adapt });
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		const answer = { interactionId: interaction.id, reply: validReply(interaction) };
		const first = a.ok("interaction.answer", { session, answer });
		await gate.arrived();
		const next = { backend: "pi" as const, sessionId: "goes-on-here" };
		const [sink] = gate.sinks;
		sink?.emit({ at: rig.clock.now(), event: { type: "session_replaced", session: next } });
		await b.ok("session.attach", { session: next });
		const second = b.ok("interaction.answer", { session: next, answer });
		await quiesce();
		expect(gate.waiting()).toBe(1);
		expect((await second).result).toMatchObject({ rejection: { code: "stale" } });
		gate.passNext();
		expect((await first).result).toEqual({ status: "accepted" });
	});

	test("an answer refused after the session went on under a new id frees the interaction there", async () => {
		const gate = answerGate();
		const rig = await startCoreRig({ adapt: gate.adapt });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		const answer = { interactionId: interaction.id, reply: validReply(interaction) };
		const first = a.ok("interaction.answer", { session, answer });
		await gate.arrived();
		const next = { backend: "pi" as const, sessionId: "goes-on-here" };
		gate.sinks[0]?.emit({ at: rig.clock.now(), event: { type: "session_replaced", session: next } });
		gate.refuseNext();
		expect((await first).result).toMatchObject({ rejection: { code: "backend_error" } });
		await a.ok("session.attach", { session: next });
		const retry = a.ok("interaction.answer", { session: next, answer });
		await gate.arrived();
		gate.passNext();
		expect((await retry).result).toEqual({ status: "accepted" });
	});

	test("a pending ask is in every attach's snapshot, keeps the session open, and is never answered for anyone", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		const first = await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		const lastSeq = a.envelopes(session).at(-1)?.seq ?? 0;
		a.close();
		rig.clock.advance(7 * 24 * 60 * 60 * 1000);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		const later = await rig.client("later");
		const answer = await later.ok("session.attach", { session });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(answer.sync.snapshot.interactions).toEqual([interaction]);
		expect(answer.sync.lastSeq).toBe(lastSeq);
		const replayed = await rig.client("replayed");
		const resumed = await replayed.ok("session.attach", { session, resume: { epoch: first.sync.epoch, seq: 1 } });
		expect(resumed.sync.kind).toBe("replay");
		expect(pending(replayed, session)).toEqual(interaction);
		const reply = { interactionId: interaction.id, reply: validReply(interaction) };
		expect((await later.ok("interaction.answer", { session, answer: reply })).result).toEqual({ status: "accepted" });
		await quiesce();
		later.close();
		replayed.close();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("an ask the backend withdraws ends without an answer, and a late answer is stale", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, CONFIRM);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		const interaction = pending(a, session);
		rig.fake.fake.answerElsewhere(session, interaction.id);
		await quiesce();
		expect(a.events(session)).toContainEqual({
			type: "interaction_resolved",
			interactionId: interaction.id,
			reason: "withdrawn",
		});
		const late = await a.ok("interaction.answer", {
			session,
			answer: { interactionId: interaction.id, reply: validReply(interaction) },
		});
		expect(late.result).toMatchObject({ rejection: { code: "stale" } });
	});
});

/** The fake, with every answer that reaches its `control.answer` recorded in `reached`. */
function recordingAnswers(reached: InteractionAnswer[]): (backend: AgentBackend) => AgentBackend {
	return (backend) =>
		wrappingSessions(backend, (session) =>
			changedSession(session, {
				control: (control) => ({
					...control,
					answer: (answer) => {
						reached.push(answer);
						return control.answer(answer);
					},
				}),
			}),
		);
}

/** The fake, with every `answer` held until the test lets it through or refuses it. */
function answerGate() {
	const gate = new Gate<boolean>();
	const sinks: SessionSink[] = [];
	const lost: ActionResult = { status: "rejected", rejection: { code: "backend_error", message: "lost" } };
	const adapt = (backend: AgentBackend): AgentBackend => {
		const gated = wrappingSessions(backend, (session) =>
			changedSession(session, {
				control: (control) => ({
					...control,
					answer: async (answer) => ((await gate.hold()) ? control.answer(answer) : lost),
				}),
			}),
		);
		return {
			...gated,
			open: (target, sink) => {
				sinks.push(sink);
				return gated.open(target, sink);
			},
		};
	};
	return {
		adapt,
		/** The sinks the core gave the adapter, for an event no fake control produces. */
		sinks,
		waiting: () => gate.count(),
		arrived: () => gate.arrived(),
		passNext: () => gate.pass(true),
		refuseNext: () => gate.pass(false),
	};
}
