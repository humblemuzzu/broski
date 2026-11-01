import { describe, expect, test } from "bun:test";
import { MAX_IMAGE_CHARS } from "../contract";
import { createFakeBackend } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { BridgeCore } from "../core/core";
import type { JournalEntry, PromptJournal } from "../core/ports";
import { MAX_SESSIONS_PER_CLIENT } from "../core/requests-live";
import { forgetfulPrompts, throwingAborts } from "./helpers/core-adapters";
import { ManualClock, promptInput, quiesce, RecordingLog, RIG_CWD, startCoreRig, TestClient } from "./helpers/core-rig";

const HOLD = [
	{ kind: "text" as const, text: "Working." },
	{ kind: "hold" as const },
	{ kind: "text" as const, text: "Done." },
];

describe("the core's prompt path", () => {
	test("start, steer and queue: one run takes the steer, the queued prompt starts the next", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await a.ok("session.attach", { session });
		const started = await a.ok("prompt", { session, input: promptInput("First") });
		expect(started.result).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		const steer = promptInput("Also this", "steer");
		const steered = await a.ok("prompt", { session, input: steer });
		expect(steered.result).toMatchObject({ status: "accepted", disposition: "steered" });
		const queued = await a.ok("prompt", { session, input: promptInput("Then this", "queue") });
		expect(queued.result).toMatchObject({ status: "accepted", disposition: "queued", queueItemId: expect.any(String) });
		const busy = await a.ok("prompt", { session, input: promptInput("Not now") });
		expect(busy.result).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		const queueSizes = a
			.events(session)
			.flatMap((event) => (event.type === "queue_changed" ? [event.items.length] : []));
		expect(queueSizes).toEqual([1, 2]);
		rig.fake.fake.release(session);
		await quiesce();
		const runs = a.events(session).flatMap((event) => (event.type === "run_started" ? [event.trigger] : []));
		expect(runs).toEqual(["prompt", "queue"]);
		const delivered = a.events(session).flatMap((event) => (event.type === "user_message" ? [event.text] : []));
		expect(delivered).toEqual(["First", "Also this", "Then this"]);
	});

	test("a prompt may carry the whole image budget, and the image comes back by reference", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		const data = "A".repeat(MAX_IMAGE_CHARS);
		const input = { ...promptInput("Look"), attachments: [{ kind: "image" as const, mimeType: "image/png", data }] };
		expect((await a.ok("prompt", { session, input })).result).toEqual({ status: "accepted", disposition: "started" });
		const message = a.events(session).find((event) => event.type === "user_message");
		const [ref] = message?.type === "user_message" ? message.attachments : [];
		if (ref?.kind !== "image_ref") throw new Error("the image did not come back by reference");
		const read = await a.ok("attachment.read", { session, attachmentId: ref.id });
		expect(read.result).toMatchObject({ status: "accepted", image: { data } });
		const tooMany = {
			...input,
			clientRequestId: crypto.randomUUID(),
			attachments: [...input.attachments, ...input.attachments],
		};
		expect(await a.request("prompt", { session, input: tooMany })).toMatchObject({
			error: { code: "invalid_message" },
		});
	});

	test("queued input can be cancelled once; abort ends the run aborted", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("First") });
		const queued = await a.ok("prompt", { session, input: promptInput("Later", "queue") });
		if (queued.result.status !== "accepted" || !queued.result.queueItemId) throw new Error("not queued");
		const queueItemId = queued.result.queueItemId;
		expect((await a.ok("queue.cancel", { session, queueItemId })).result).toEqual({ status: "accepted" });
		expect((await a.ok("queue.cancel", { session, queueItemId })).result.status).toBe("rejected");
		expect((await a.ok("abort", { session })).result).toEqual({ status: "accepted" });
		await quiesce();
		expect(a.events(session).at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "aborted" } });
		expect((await a.ok("abort", { session })).result).toEqual({ status: "accepted" });
	});

	test("model, thinking, mode and compaction reach the adapter and show as events", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		expect((await a.ok("thinking.set", { session, thinking: "high" })).result.status).toBe("accepted");
		expect((await a.ok("model.set", { session, modelId: "nope" })).result).toMatchObject({
			status: "rejected",
			rejection: { code: "not_found" },
		});
		expect((await a.ok("model.set", { session, modelId: "fake-small" })).result.status).toBe("accepted");
		expect((await a.ok("mode.set", { session, axis: "permissions", value: "edits" })).result.status).toBe("accepted");
		expect((await a.ok("mode.set", { session, axis: "permissions", value: "x" })).result).toMatchObject({
			rejection: { code: "invalid_input" },
		});
		expect((await a.ok("compact", { session })).result.status).toBe("accepted");
		expect(a.events(session).map((event) => event.type)).toEqual([
			"model_changed",
			"model_changed",
			"mode_changed",
			"compaction_started",
			"compaction_finished",
		]);
	});

	test("control needs an attached session", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const requests = [
			await a.request("prompt", { session, input: promptInput("x") }),
			await a.request("abort", { session }),
			await a.request("interaction.answer", {
				session,
				answer: { interactionId: "i", reply: { kind: "cancel", stopRun: false } },
			}),
			await a.request("queue.cancel", { session, queueItemId: "q" }),
			await a.request("model.set", { session, modelId: "fake-small" }),
			await a.request("thinking.set", { session, thinking: "high" }),
			await a.request("mode.set", { session, axis: "agent", value: "plan" }),
			await a.request("compact", { session }),
		];
		expect(requests.map((answer) => answer.type === "error" && answer.error.code)).toEqual(
			Array(requests.length).fill("not_attached"),
		);
		expect(rig.opens.opened).toEqual([]);
	});

	test("a client views a bounded number of sessions at once", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const sessions = Array.from({ length: MAX_SESSIONS_PER_CLIENT + 1 }, () => rig.fake.fake.seed({ cwd: RIG_CWD }));
		for (const session of sessions.slice(0, -1)) await a.ok("session.attach", { session });
		const [last, first] = [sessions.at(-1), sessions[0]];
		if (!last || !first) throw new Error("no sessions");
		expect(await a.request("session.attach", { session: last })).toMatchObject({ error: { code: "invalid_message" } });
		await a.ok("session.attach", { session: first });
		await a.ok("session.detach", { session: first });
		await a.ok("session.attach", { session: last });
	});

	test("attaches sent all at once still view no more than the bound, and a refused one opens nothing", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const sessions = Array.from({ length: 3 * MAX_SESSIONS_PER_CLIENT }, () => rig.fake.fake.seed({ cwd: RIG_CWD }));
		const answers = await Promise.all(sessions.map((session) => a.request("session.attach", { session })));
		const viewed = sessions.filter((_, index) => answers[index]?.type === "session.attach.result");
		const refused = sessions.filter((_, index) => answers[index]?.type === "error");
		expect([viewed.length, refused.length]).toEqual([MAX_SESSIONS_PER_CLIENT, 2 * MAX_SESSIONS_PER_CLIENT]);
		expect(rig.opens.opened).toHaveLength(MAX_SESSIONS_PER_CLIENT);
		const [again] = viewed;
		const [other] = refused;
		if (!again || !other) throw new Error("no sessions");
		await a.ok("session.attach", { session: again });
		expect(await a.request("session.attach", { session: other })).toMatchObject({ error: { code: "invalid_message" } });
	});

	test("an adapter that throws is a bug the client hears about as internal, and the bridge goes on", async () => {
		const rig = await startCoreRig({ adapt: throwingAborts });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		expect(await a.request("abort", { session })).toMatchObject({ type: "error", error: { code: "internal" } });
		expect(rig.log.errors.some((line) => line.includes("abort") && line.includes("kaput"))).toBe(true);
		expect((await a.ok("prompt", { session, input: promptInput("Still here") })).result.status).toBe("accepted");
		const forged = "x\n[core] a line the phone wrote";
		await a.sendFrame({ type: "contract", message: { type: "abort", requestId: forged, session } });
		expect(rig.log.errors.some((line) => line.includes(JSON.stringify(forged)))).toBe(true);
		expect(rig.log.errors.some((line) => line.includes(forged))).toBe(false);
	});

	test("an attach and the requests sent right behind it act in order", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const [attached, prompted, detached] = await Promise.all([
			a.request("session.attach", { session }),
			a.request("prompt", { session, input: promptInput("Right away") }),
			a.request("session.detach", { session }),
		]);
		expect(attached.type).toBe("session.attach.result");
		expect(prompted).toMatchObject({ type: "prompt.result", result: { status: "accepted" } });
		expect(detached.type).toBe("session.detach.result");
	});

	test("a session another client owns can be watched but not controlled", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD, external: true });
		const answer = await a.ok("session.attach", { session });
		expect(answer.capabilities).toEqual({
			controllable: false,
			compact: false,
			cancelQueued: false,
			cancelCompaction: false,
			cancelRetry: false,
			answer: false,
		});
		const results = [
			(await a.ok("prompt", { session, input: promptInput("x") })).result,
			(await a.ok("abort", { session })).result,
			(await a.ok("model.set", { session, modelId: "fake-small" })).result,
			(
				await a.ok("interaction.answer", {
					session,
					answer: { interactionId: "i", reply: { kind: "cancel", stopRun: false } },
				})
			).result,
		];
		expect(results.map((result) => result.status === "rejected" && result.rejection.code)).toEqual(
			Array(results.length).fill("unsupported"),
		);
	});
});

describe("prompt idempotency", () => {
	test("a repeated clientRequestId gets the first result and runs once, even sent twice at once", async () => {
		const rig = await startCoreRig({ adapt: forgetfulPrompts });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		const input = promptInput("Once");
		const [one, two] = await Promise.all([a.ok("prompt", { session, input }), a.ok("prompt", { session, input })]);
		await quiesce();
		const three = await a.ok("prompt", { session, input });
		expect([two.result, three.result]).toEqual([one.result, one.result]);
		expect(a.events(session).filter((event) => event.type === "run_started")).toHaveLength(1);
	});

	test("a rejected prompt is not remembered: the same id is served once the cause is gone", async () => {
		const rig = await startCoreRig({ adapt: forgetfulPrompts });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Hold on") });
		const retried = promptInput("After");
		expect((await a.ok("prompt", { session, input: retried })).result).toMatchObject({ rejection: { code: "busy" } });
		rig.fake.fake.release(session);
		await quiesce();
		expect((await a.ok("prompt", { session, input: retried })).result).toEqual({
			status: "accepted",
			disposition: "started",
		});
	});

	test("an accepted prompt is remembered across a close of the session and across a bridge restart", async () => {
		const journal = memoryJournal();
		const clock = new ManualClock();
		const first = await coreWithFake(journal, clock);
		const a = new TestClient(first.core, "a");
		await a.hello();
		const session = first.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		const input = promptInput("Remember me");
		const accepted = (await a.ok("prompt", { session, input })).result;
		if (accepted.status !== "accepted") throw new Error("the prompt was not accepted");
		await quiesce();
		await a.ok("session.detach", { session });
		clock.advance(60 * 60 * 1000);
		await a.ok("session.attach", { session });
		expect((await a.ok("prompt", { session, input })).result).toEqual(accepted);
		await first.core.dispose();
		expect(journal.entries).toEqual([{ session, clientRequestId: input.clientRequestId, result: accepted }]);

		const restarted = await coreWithFake(journal, clock, (host) => first.fake.fake.restart(host));
		const b = new TestClient(restarted.core, "b");
		await b.hello();
		await b.ok("session.attach", { session });
		expect((await b.ok("prompt", { session, input })).result).toEqual(accepted);
		await quiesce();
		expect(b.events(session).filter((event) => event.type === "run_started")).toEqual([]);
	});
});

describe("a bridge restart", () => {
	test("a run that does not survive it is over in the new bridge's snapshot, and its ask has expired", async () => {
		const clock = new ManualClock();
		const traits = { ...FULL_TRAITS, durableRuns: false };
		const first = await coreWithFake(memoryJournal(), clock, (host) =>
			Promise.resolve(createFakeBackend(host, { traits })),
		);
		const a = new TestClient(first.core, "a");
		await a.hello();
		const session = first.fake.fake.seed({ cwd: RIG_CWD });
		first.fake.fake.script(session, [{ kind: "ask", title: "Go on?", request: { kind: "confirm" } }]);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Ask me") });
		await quiesce();
		await first.core.dispose();

		const second = await coreWithFake(memoryJournal(), clock, (host) => first.fake.fake.restart(host));
		const b = new TestClient(second.core, "b");
		await b.hello();
		const answer = await b.ok("session.attach", { session });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(answer.sync.snapshot).toMatchObject({ interactions: [], lastOutcome: { kind: "aborted" } });
		expect(answer.sync.snapshot.run).toBeUndefined();
	});
});

function memoryJournal(): PromptJournal & { entries: JournalEntry[] } {
	const entries: JournalEntry[] = [];
	return { entries, load: () => [...entries], append: (entry) => entries.push(entry) };
}

async function coreWithFake(
	journal: PromptJournal,
	clock: ManualClock,
	make = (host: Parameters<typeof createFakeBackend>[0]) => Promise.resolve(createFakeBackend(host)),
) {
	const core = new BridgeCore({
		bridgeVersion: "0.0.0-test",
		maxFrameBytes: 8 * 1024 * 1024,
		log: new RecordingLog(),
		clock,
		directories: async (path) => path,
		journal,
	});
	let fake: Awaited<ReturnType<typeof make>> | undefined;
	await core.addBackend("pi", async (host) => {
		fake = await make(host);
		return forgetfulPrompts(fake);
	});
	if (!fake) throw new Error("the fake did not start");
	return { core, fake };
}
