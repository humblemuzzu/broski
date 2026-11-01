import { describe, expect, test } from "bun:test";
import type { JsonValue } from "../contract";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import {
	changedSession,
	corruptingDeltas,
	driftingSnapshots,
	noticeRightAfterOpen,
	throwingSnapshots,
	wrappingSessions,
} from "./helpers/core-adapters";
import { attachForSnapshot, promptInput, quiesce, RIG_CWD, startCoreRig, streamProblems } from "./helpers/core-rig";

describe("the core's session streams", () => {
	test("an attach starts from a snapshot, and only viewers get the stream, numbered from 1 without gaps", async () => {
		const rig = await startCoreRig();
		const viewer = await rig.client("viewer");
		const bystander = await rig.client("bystander");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const answer = await viewer.ok("session.attach", { session });
		expect(answer.capabilities).toEqual({
			controllable: true,
			compact: true,
			cancelQueued: true,
			cancelCompaction: true,
			cancelRetry: true,
			answer: true,
		});
		expect(answer.sync).toMatchObject({ kind: "snapshot", lastSeq: 0 });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		const prompted = await viewer.ok("prompt", { session, input: promptInput("Hello") });
		expect(prompted.result).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		const envelopes = viewer.envelopes(session);
		expect(envelopes.map((envelope) => envelope.seq)).toEqual(envelopes.map((_, index) => index + 1));
		expect(envelopes.at(-1)?.event).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(streamProblems(viewer, session, FULL_TRAITS, answer.sync.snapshot)).toEqual([]);
		expect(bystander.envelopes()).toEqual([]);
		expect([...viewer.violations, ...bystander.violations, ...rig.log.errors]).toEqual([]);
	});

	test("every viewer gets the same stream, and a viewer that detaches gets no more of it", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await b.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("One") });
		await quiesce();
		expect(b.envelopes(session)).toEqual(a.envelopes(session));
		await b.ok("session.detach", { session });
		const seen = b.envelopes(session).length;
		await a.ok("prompt", { session, input: promptInput("Two") });
		await quiesce();
		expect(b.envelopes(session)).toHaveLength(seen);
		expect(a.envelopes(session).length).toBeGreaterThan(seen);
		expect(await b.request("session.detach", { session })).toMatchObject({ error: { code: "not_attached" } });
	});

	test("a viewer whose link throws neither keeps the event from the others nor stops what follows it", async () => {
		const rig = await startCoreRig();
		const answers: string[] = [];
		const broken = rig.core.connect({
			send: (frame) => {
				if (frame.includes('"type":"event"')) throw new Error("the link is gone");
				answers.push(frame);
			},
		});
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const message = (type: string, body: { [key: string]: JsonValue }): JsonValue => ({
			type: "contract",
			message: { type, requestId: type, ...body },
		});
		await broken.receive(
			message("hello", { protocol: { major: 1, minor: 0 }, client: { name: "x", version: "1" } }),
			0,
		);
		await broken.receive(message("session.attach", { session }), 0);
		expect(answers.map((frame) => JSON.parse(frame).message.type)).toEqual(["hello.result", "session.attach.result"]);
		const steady = await rig.client("steady");
		await steady.ok("session.attach", { session });
		rig.fake.fake.script(session, [{ kind: "text", text: "Before." }, { kind: "replace_session" }, { kind: "hold" }]);
		await steady.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const last = steady.events(session).at(-1);
		if (last?.type !== "session_replaced") throw new Error(`the stream ended with ${last?.type}`);
		expect((await steady.ok("session.attach", { session: last.session })).sync).toMatchObject({ lastSeq: 0 });
		expect(rig.opens.opened).toEqual([session.sessionId]);
		expect(rig.log.errors.some((line) => line.includes("the link is gone"))).toBe(true);
	});

	test("a reattach from the last seq it saw gets exactly the events it missed", async () => {
		const rig = await startCoreRig();
		const steady = await rig.client("steady");
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await steady.ok("session.attach", { session });
		const first = await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("One") });
		await quiesce();
		const last = phone.envelopes(session).at(-1)?.seq ?? 0;
		phone.close();
		await steady.ok("prompt", { session, input: promptInput("Two") });
		await quiesce();
		const back = await rig.client("phone-again");
		const answer = await back.ok("session.attach", { session, resume: { epoch: first.sync.epoch, seq: last } });
		expect(answer.sync).toEqual({ kind: "replay", epoch: first.sync.epoch, afterSeq: last });
		const missed = steady.envelopes(session).filter((envelope) => envelope.seq > last);
		expect(missed.length).toBeGreaterThan(0);
		expect(back.envelopes(session)).toEqual(missed);
	});

	test("a reattach from another epoch, or from before what the log holds, gets a snapshot", async () => {
		const rig = await startCoreRig({ core: { replay: { maxEvents: 4, maxBytes: 1 << 20 } } });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const first = await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Fill the log") });
		await quiesce();
		const last = a.envelopes(session).at(-1)?.seq ?? 0;
		expect(last).toBeGreaterThan(5);
		const stale = await a.ok("session.attach", { session, resume: { epoch: "an-old-epoch", seq: 2 } });
		expect(stale.sync).toMatchObject({ kind: "snapshot", epoch: first.sync.epoch, lastSeq: last });
		const tooOld = await a.ok("session.attach", { session, resume: { epoch: first.sync.epoch, seq: 1 } });
		expect(tooOld.sync).toMatchObject({ kind: "snapshot", lastSeq: last });
		const covered = await a.ok("session.attach", { session, resume: { epoch: first.sync.epoch, seq: last - 4 } });
		expect(covered.sync).toEqual({ kind: "replay", epoch: first.sync.epoch, afterSeq: last - 4 });
		const ahead = await a.ok("session.attach", { session, resume: { epoch: first.sync.epoch, seq: last + 1 } });
		expect(ahead.sync.kind).toBe("snapshot");
	});

	test("events an adapter emits before the core holds the session are kept, so a mid-run attach misses nothing", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.runExternally(session, "From the terminal.", [
			{ kind: "text", text: "A reply that streams in parts." },
			{ kind: "text", text: "And another." },
		]);
		const answer = await a.ok("session.attach", { session });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(answer.sync.snapshot.run?.trigger).toBe("external");
		await quiesce();
		expect(a.events(session).at(-1)?.type).toBe("run_finished");
		expect(streamProblems(a, session, FULL_TRAITS, answer.sync.snapshot)).toEqual([]);
	});

	test("a record emitted right after open resolves, before the core holds the session, is published, not lost", async () => {
		const rig = await startCoreRig({ adapt: noticeRightAfterOpen });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const answer = await a.ok("session.attach", { session });
		expect(answer.sync.kind === "snapshot" && answer.sync.lastSeq).toBe(1);
		const b = await rig.client("b");
		const replayed = await b.ok("session.attach", { session, resume: { epoch: answer.sync.epoch, seq: 0 } });
		expect(replayed.sync.kind).toBe("replay");
		expect(b.events(session)).toEqual([{ type: "notice", level: "info", text: "right after open" }]);
	});

	test("an adapter whose snapshot drifts from its events is resynced to its own state", async () => {
		let drift = false;
		const rig = await startCoreRig({ adapt: driftingSnapshots(() => drift) });
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		drift = true;
		const answer = await b.ok("session.attach", { session });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(answer.sync.snapshot.modelId).toBe("drifted");
		expect(a.events(session)).toEqual([{ type: "resynced", snapshot: answer.sync.snapshot }]);
		expect(answer.sync.lastSeq).toBe(1);
		expect(b.events(session)).toEqual([]);
		expect(rig.log.errors.some((line) => line.includes("differs"))).toBe(true);
	});

	test("an adapter that writes the same state with its keys in another order is not resynced", async () => {
		const reversed = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;
		const rig = await startCoreRig({
			adapt: (backend) =>
				wrappingSessions(backend, (session) =>
					changedSession(session, { snapshot: () => reversed(session.snapshot()) }),
				),
		});
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		await (await rig.client("b")).ok("session.attach", { session });
		expect(a.events(session).map((event) => event.type)).not.toContain("resynced");
		expect(rig.log.errors).toEqual([]);
	});

	test("an event that breaks the contract never reaches a phone; the adapter's state replaces it", async () => {
		const rig = await startCoreRig({ adapt: corruptingDeltas });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const initial = await attachForSnapshot(a, session);
		await a.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const types = a.events(session).map((event) => event.type);
		expect(types).not.toContain("block_delta");
		expect(types).toContain("resynced");
		expect(types.at(-1)).toBe("run_finished");
		expect(streamProblems(a, session, FULL_TRAITS, initial)).toEqual([]);
		expect(a.violations).toEqual([]);
		expect(rig.log.errors.some((line) => line.includes("breaks the contract"))).toBe(true);
	});

	test("an event and a snapshot that both break the contract change nothing a phone sees", async () => {
		const rig = await startCoreRig({
			adapt: (backend) =>
				corruptingDeltas(
					wrappingSessions(backend, (session) =>
						changedSession(session, { snapshot: () => ({ ...session.snapshot(), modelId: "" }) }),
					),
				),
		});
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const types = a.events(session).map((event) => event.type);
		expect(types).not.toContain("block_delta");
		expect(types).not.toContain("resynced");
		expect(a.violations).toEqual([]);
		expect(rig.log.errors.some((line) => line.includes("breaks the contract too"))).toBe(true);
	});

	test("the sink never throws into the adapter, even when the core fails on what it emitted", async () => {
		let broken = false;
		const rig = await startCoreRig({ adapt: (backend) => throwingSnapshots(corruptingDeltas(backend), () => broken) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		broken = true;
		await a.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		expect(a.events(session).at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(rig.log.errors.some((line) => line.includes("an event failed in the core"))).toBe(true);
	});
});
