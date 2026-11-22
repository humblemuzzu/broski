import { describe, expect, test } from "bun:test";
import type { AgentBackend, InteractionAnswer, InteractionRequest, SessionRef, SessionSnapshot } from "../contract";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import type { ExternalInteractionSpec } from "../core/external-interactions";
import type { ObservedEvent } from "../core/observer";
import { recordingAnswers } from "./helpers/core-adapters";
import {
	attachForSnapshot,
	type CoreRig,
	promptInput,
	quiesce,
	RIG_CWD,
	startCoreRig,
	streamProblems,
	type TestClient,
} from "./helpers/core-rig";

const HOLD = [{ kind: "text" as const, text: "Working." }, { kind: "hold" as const }];

const QUESTION: InteractionRequest = {
	kind: "questions",
	questions: [
		{
			id: "store",
			text: "Which store?",
			options: [{ label: "Postgres" }, { label: "SQLite" }],
			multiSelect: false,
			allowCustom: true,
			secret: false,
			required: true,
		},
	],
};

const SPEC: ExternalInteractionSpec = { title: "Pick a store", request: QUESTION };

function answerTo(interactionId: string): InteractionAnswer {
	return { interactionId, reply: { kind: "questions", answers: [{ questionId: "store", selected: ["SQLite"] }] } };
}

interface Running {
	readonly rig: CoreRig;
	readonly phone: TestClient;
	readonly session: SessionRef;
	readonly initial: SessionSnapshot;
	readonly observed: ObservedEvent[];
	readonly answers: InteractionAnswer[];
}

/** A phone viewing a session whose run holds, with the observer and the adapter's answers recorded. */
async function running(adapt?: (backend: AgentBackend) => AgentBackend): Promise<Running> {
	const observed: ObservedEvent[] = [];
	const answers: InteractionAnswer[] = [];
	const rig = await startCoreRig({
		core: { observer: { observe: (event) => void observed.push(event) } },
		adapt: (backend) => recordingAnswers(adapt ? adapt(backend) : backend, answers),
	});
	const phone = await rig.client("phone");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, HOLD);
	const initial = await attachForSnapshot(phone, session);
	await phone.ok("prompt", { session, input: promptInput("Go") });
	await quiesce();
	return { rig, phone, session, initial, observed, answers };
}

function asked(phone: TestClient, session: SessionRef): string {
	const event = phone.events(session).find((candidate) => candidate.type === "interaction_requested");
	if (event?.type !== "interaction_requested") throw new Error("no interaction reached the phone");
	return event.interaction.id;
}

function resolutions(phone: TestClient, session: SessionRef): string[] {
	return phone.events(session).flatMap((event) => (event.type === "interaction_resolved" ? [event.reason] : []));
}

describe("an ask the bridge raises itself", () => {
	test("reaches every viewer, a later attach and the observer, and the first answer goes to the asker alone", async () => {
		const { rig, phone, session, initial, observed, answers } = await running();
		const other = await rig.client("other");
		await other.ok("session.attach", { session });
		const outcome = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		const id = asked(phone, session);
		expect(asked(other, session)).toBe(id);
		const seqs = phone.envelopes(session).map((envelope) => envelope.seq);
		expect(seqs).toEqual(seqs.map((_, index) => index + 1));
		const run = phone.events(session).find((event) => event.type === "run_started");
		const [requested] = phone.events(session).filter((event) => event.type === "interaction_requested");
		expect(requested).toMatchObject({
			interaction: { runId: run?.type === "run_started" ? run.runId : "", blocksRun: true },
		});
		expect(observed.some(({ event }) => event.type === "interaction_requested")).toBe(true);
		const late = await rig.client("late");
		const snapshot = await attachForSnapshot(late, session);
		expect(snapshot.interactions.map((interaction) => interaction.id)).toEqual([id]);
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);

		const [first, second] = await Promise.all([
			other.ok("interaction.answer", { session, answer: answerTo(id) }),
			late.ok("interaction.answer", { session, answer: answerTo(id) }),
		]);
		expect([first.result.status, second.result.status].sort()).toEqual(["accepted", "rejected"]);
		expect(await outcome).toEqual({ kind: "answered", reply: answerTo(id).reply });
		expect(answers).toEqual([]);
		expect(resolutions(phone, session)).toEqual(["answered"]);
		expect((await late.ok("interaction.answer", { session, answer: answerTo(id) })).result).toMatchObject({
			rejection: { code: "stale" },
		});
		rig.fake.fake.release(session);
		await quiesce();
		expect(streamProblems(phone, session, FULL_TRAITS, initial)).toEqual([]);
		expect(rig.log.errors).toEqual([]);
	});

	test("is answered from a lock screen through the desk, checked like a phone's answer", async () => {
		const { rig, phone, session } = await running();
		const outcome = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		const id = asked(phone, session);
		rig.fake.fake.resync(session);
		expect(phone.events(session).at(-1)).toMatchObject({ type: "resynced", snapshot: { interactions: [{ id }] } });
		const wrong = { interactionId: id, reply: { kind: "confirm" as const, confirmed: true } };
		expect(await rig.core.answer(session, wrong)).toMatchObject({ rejection: { code: "invalid_input" } });
		expect(await rig.core.answer(session, answerTo(id))).toEqual({ status: "accepted" });
		expect(await outcome).toMatchObject({ kind: "answered" });
		expect(await rig.core.answer(session, answerTo(id))).toMatchObject({ rejection: { code: "stale" } });
	});

	test("holds the session open with nobody viewing it, and lets it close once it ends", async () => {
		const { rig, phone, session } = await running();
		const controller = new AbortController();
		const outcome = rig.core.raiseExternalInteraction(session, { ...SPEC, blocksRun: false }, controller.signal);
		await quiesce();
		rig.fake.fake.release(session);
		await quiesce();
		await phone.ok("session.detach", { session });
		rig.clock.advance(10 * 60 * 1000);
		expect(rig.opens.closed).toEqual([]);
		controller.abort();
		expect(await outcome).toEqual({ kind: "ended", reason: "withdrawn" });
		rig.clock.advance(10 * 60 * 1000);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("is withdrawn before the run it blocks finishes, and a stop reply stops the run", async () => {
		const { rig, phone, session, initial } = await running();
		const outcome = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		await phone.ok("abort", { session });
		await quiesce();
		expect(await outcome).toEqual({ kind: "ended", reason: "withdrawn" });
		const types = phone.events(session).map((event) => event.type);
		expect(types.indexOf("interaction_resolved")).toBeLessThan(types.indexOf("run_finished"));
		expect(streamProblems(phone, session, FULL_TRAITS, initial)).toEqual([]);

		rig.fake.fake.script(session, HOLD);
		await phone.ok("prompt", { session, input: promptInput("Again") });
		await quiesce();
		const stopping = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		const id = phone
			.events(session)
			.flatMap((event) => (event.type === "interaction_requested" ? [event.interaction.id] : []))
			.at(-1);
		if (!id) throw new Error("no second ask");
		const stop = { interactionId: id, reply: { kind: "cancel" as const, stopRun: true } };
		expect((await phone.ok("interaction.answer", { session, answer: stop })).result).toEqual({ status: "accepted" });
		expect(await stopping).toEqual({ kind: "answered", reply: stop.reply });
		await quiesce();
		expect(phone.events(session).at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
	});

	test("one that blocks nothing names no run, so it may outlive the run within the contract", async () => {
		const { rig, phone, session, initial } = await running();
		const outcome = rig.core.raiseExternalInteraction(
			session,
			{ ...SPEC, blocksRun: false },
			new AbortController().signal,
		);
		await quiesce();
		const [requested] = phone.events(session).filter((event) => event.type === "interaction_requested");
		expect(requested).toMatchObject({ interaction: { blocksRun: false } });
		expect(requested?.type === "interaction_requested" && requested.interaction.runId).toBeUndefined();
		rig.fake.fake.release(session);
		await quiesce();
		expect(phone.events(session).at(-1)).toMatchObject({ type: "run_finished" });
		expect(await rig.core.answer(session, answerTo(asked(phone, session)))).toEqual({ status: "accepted" });
		expect(await outcome).toMatchObject({ kind: "answered" });
		expect(streamProblems(phone, session, FULL_TRAITS, initial)).toEqual([]);
	});

	test("goes on with the session that replaces its own, and is answered there", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "hold" }, { kind: "replace_session" }, { kind: "hold" }]);
		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const outcome = rig.core.raiseExternalInteraction(
			session,
			{ ...SPEC, blocksRun: false },
			new AbortController().signal,
		);
		await quiesce();
		const id = asked(phone, session);
		rig.fake.fake.release(session);
		await quiesce();
		const replaced = phone.events(session).find((event) => event.type === "session_replaced");
		if (replaced?.type !== "session_replaced") throw new Error("the session was not replaced");
		const next = replaced.session;
		const snapshot = await attachForSnapshot(phone, next);
		expect(snapshot.interactions.map((interaction) => interaction.id)).toEqual([id]);
		expect((await phone.ok("interaction.answer", { session: next, answer: answerTo(id) })).result).toEqual({
			status: "accepted",
		});
		expect(await outcome).toMatchObject({ kind: "answered" });
	});

	test("expires when the session is removed or the bridge stops", async () => {
		const { rig, phone, session } = await running();
		const removed = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		rig.host.catalog.emit({ type: "session_removed", session });
		expect(await removed).toEqual({ kind: "ended", reason: "expired" });
		expect(resolutions(phone, session)).toEqual(["expired"]);

		const other = rig.fake.fake.seed({ cwd: RIG_CWD });
		const stopped = rig.core.raiseExternalInteraction(other, SPEC, new AbortController().signal);
		await quiesce();
		await rig.core.dispose();
		expect(await stopped).toEqual({ kind: "ended", reason: "expired" });
	});

	test("ends withdrawn at once for a signal already aborted or a session that cannot open", async () => {
		const { rig, session } = await running();
		const controller = new AbortController();
		controller.abort();
		expect(await rig.core.raiseExternalInteraction(session, SPEC, controller.signal)).toEqual({
			kind: "ended",
			reason: "withdrawn",
		});
		const missing = { backend: session.backend, sessionId: "no-such-session" };
		expect(await rig.core.raiseExternalInteraction(missing, SPEC, new AbortController().signal)).toEqual({
			kind: "ended",
			reason: "withdrawn",
		});
	});

	test("outside a run it blocks nothing, and survives a reconcile with the adapter's own snapshot", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		const outcome = rig.core.raiseExternalInteraction(session, SPEC, new AbortController().signal);
		await quiesce();
		const [requested] = phone.events(session);
		expect(requested).toMatchObject({ type: "interaction_requested", interaction: { blocksRun: false } });
		expect(requested?.type === "interaction_requested" && requested.interaction.runId).toBeUndefined();
		await phone.ok("session.attach", { session });
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);
		await rig.core.answer(session, answerTo(asked(phone, session)));
		expect(await outcome).toMatchObject({ kind: "answered" });
	});
});

describe("a notice the bridge sends itself", () => {
	test("reaches the viewers of an open session, bounded; a session that is not open is not found", async () => {
		const { rig, phone, session } = await running();
		const sent = await rig.core.emitExternalNotice(session, {
			level: "warning",
			text: `Disk ${"x".repeat(2_000_000)}`,
		});
		expect(sent).toEqual({ status: "accepted" });
		const notice = phone.events(session).find((event) => event.type === "notice");
		expect(notice).toMatchObject({ type: "notice", level: "warning" });
		expect(notice?.type === "notice" && notice.text.length).toBe(1_048_576);
		const closed = rig.fake.fake.seed({ cwd: RIG_CWD });
		expect(await rig.core.emitExternalNotice(closed, { level: "info", text: "hi" })).toMatchObject({
			rejection: { code: "not_found" },
		});
	});
});
