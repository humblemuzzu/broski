import { describe, expect, test } from "bun:test";
import type { AgentBackend, ProtocolVersion, SessionRef } from "../contract";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import type { ReplacementRecord } from "../core/ports";
import { REPLACEMENT_MEMORY, REPLACEMENT_TTL_MS, Replacements } from "../core/replacements";
import { Gate } from "./helpers/core-adapters";
import { type CoreRig, ManualClock, promptInput, quiesce, RIG_CWD, startCoreRig, TestClient } from "./helpers/core-rig";

const MINOR_ZERO: ProtocolVersion = { major: 1, minor: 0 };

interface Away {
	readonly old: SessionRef;
	readonly epoch: string;
	readonly seq: number;
	/** The first session the conversation went on as, and the last. */
	readonly first: SessionRef;
	readonly last: SessionRef;
}

/**
 * The sessions the fake's conversation went on as, in order: it announces each new live session in the
 * catalog (only the first reaches `phone` as an event, since a replaced stream's viewers are let go).
 */
function successorsIn(phone: TestClient, old: SessionRef): SessionRef[] {
	const seen = new Set([old.sessionId]);
	return phone.catalog().flatMap(({ event }) => {
		if (event.type !== "session_updated" || seen.has(event.summary.session.sessionId)) return [];
		seen.add(event.summary.session.sessionId);
		return [event.summary.session];
	});
}

/**
 * A phone attaches to a session, leaves, and the session is replaced `times` times while it is away.
 * Returns what the phone held when it left, and the sessions the conversation went on as.
 */
async function replacedWhileAway(rig: CoreRig, times: number): Promise<Away> {
	const phone = await rig.client("away");
	const other = await rig.client("other");
	const old = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(old, [
		{ kind: "text", text: "Before." },
		...Array.from({ length: times }, () => ({ kind: "replace_session" as const })),
		{ kind: "hold" },
	]);
	const held = await phone.ok("session.attach", { session: old });
	if (held.sync.kind !== "snapshot") throw new Error("a fresh attach gets a snapshot");
	phone.close();
	await other.ok("session.attach", { session: old });
	await other.ok("prompt", { session: old, input: promptInput("Clear") });
	await quiesce();
	const replacedBy = successorsIn(other, old);
	expect(replacedBy).toHaveLength(times);
	const [first, last] = [replacedBy[0], replacedBy.at(-1)];
	if (!first || !last) throw new Error("the session was not replaced");
	expect(other.events().find((event) => event.type === "session_replaced")).toEqual({
		type: "session_replaced",
		session: first,
	});
	return { old, epoch: held.sync.epoch, seq: held.sync.lastSeq, first, last };
}

describe("a session replaced while the phone is away", () => {
	test("the phone that resumes the ended stream is told where the conversation went on, and views nothing", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const back = await rig.client("back");
		const answer = await back.ok("session.attach", {
			session: away.old,
			resume: { epoch: away.epoch, seq: away.seq },
		});
		expect(answer.sync).toEqual({ kind: "replaced", epoch: away.epoch, session: away.first });
		expect(answer.capabilities).toEqual({
			controllable: true,
			compact: true,
			cancelQueued: true,
			cancelCompaction: true,
			cancelRetry: true,
			answer: true,
		});
		expect(await back.request("abort", { session: away.old })).toMatchObject({ error: { code: "not_attached" } });
		expect(await back.request("abort", { session: away.first })).toMatchObject({
			error: { code: "not_attached" },
		});
		expect(rig.opens.opened).toEqual([away.old.sessionId]);
		expect([...back.violations, ...rig.log.errors]).toEqual([]);
	});

	test("the successor it is told of attaches like any session, and carries the run that was under way", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const back = await rig.client("back");
		const told = await back.ok("session.attach", { session: away.old, resume: { epoch: away.epoch, seq: away.seq } });
		if (told.sync.kind !== "replaced") throw new Error("expected a redirect");
		const attached = await back.ok("session.attach", { session: told.sync.session });
		expect(attached.sync).toMatchObject({ kind: "snapshot" });
		if (attached.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(attached.sync.snapshot.run).toBeDefined();
		expect(attached.capabilities).toEqual(told.capabilities);
	});

	test("a chain of replacements is followed to its end from the first epoch alone", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 3);
		const back = await rig.client("back");
		const answer = await back.ok("session.attach", {
			session: away.old,
			resume: { epoch: away.epoch, seq: away.seq },
		});
		expect(answer.sync).toEqual({ kind: "replaced", epoch: away.epoch, session: away.last });
	});

	test("an app of minor 0 is attached to the session it named, as before, and is never sent the new shape", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const back = await rig.client("back", MINOR_ZERO);
		const answer = await back.ok("session.attach", {
			session: away.old,
			resume: { epoch: away.epoch, seq: away.seq },
		});
		expect(answer.sync).toMatchObject({ kind: "snapshot" });
		expect(await back.request("abort", { session: away.old })).toMatchObject({ result: { status: "accepted" } });
	});

	test("opening the old session on purpose, without resuming its ended stream, shows its history", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const back = await rig.client("back");
		const fresh = await back.ok("session.attach", { session: away.old });
		expect(fresh.sync).toMatchObject({ kind: "snapshot" });
		const held = fresh.sync.epoch;
		await back.ok("session.detach", { session: away.old });
		const again = await back.ok("session.attach", { session: away.old, resume: { epoch: held, seq: 0 } });
		expect(again.sync.kind).not.toBe("replaced");
	});

	test("an epoch that never ended in a replacement is attached as usual", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const back = await rig.client("back");
		const answer = await back.ok("session.attach", {
			session: away.old,
			resume: { epoch: "never-seen", seq: 3 },
		});
		expect(answer.sync).toMatchObject({ kind: "snapshot" });
	});

	test("a successor the backend no longer has is a session that no longer exists", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		const successor = away.first;
		const other = await rig.client("deleter");
		await other.ok("session.delete", { session: successor });
		const back = await rig.client("back");
		expect(
			await back.request("session.attach", { session: away.old, resume: { epoch: away.epoch, seq: away.seq } }),
		).toMatchObject({ error: { code: "unknown_session" } });
	});

	test("what is remembered ends after thirty days", async () => {
		const rig = await startCoreRig();
		const away = await replacedWhileAway(rig, 1);
		rig.clock.advance(REPLACEMENT_TTL_MS);
		const early = await (await rig.client("back")).ok("session.attach", {
			session: away.old,
			resume: { epoch: away.epoch, seq: away.seq },
		});
		expect(early.sync.kind).toBe("replaced");
		rig.clock.advance(1);
		const late = await (await rig.client("back")).ok("session.attach", {
			session: away.old,
			resume: { epoch: away.epoch, seq: away.seq },
		});
		expect(late.sync.kind).toBe("snapshot");
	});
});

describe("an attach under way when the session is replaced", () => {
	test("is told where the conversation went on", async () => {
		let replaceTo: SessionRef | undefined;
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) => {
					const result = await backend.open(target, sink);
					if (replaceTo && target.kind === "existing" && target.session.sessionId !== replaceTo.sessionId) {
						const next = replaceTo;
						queueMicrotask(() => sink.emit({ at: 1, event: { type: "session_replaced", session: next } }));
					}
					return result;
				},
			}),
		});
		const old = rig.fake.fake.seed({ cwd: RIG_CWD });
		replaceTo = rig.fake.fake.seed({ cwd: RIG_CWD });
		const client = await rig.client("a");
		const answer = await client.ok("session.attach", { session: old });
		expect(answer.sync).toMatchObject({ kind: "replaced", session: replaceTo });
		expect(await client.request("abort", { session: old })).toMatchObject({ error: { code: "not_attached" } });
	});
});

describe("a successor that is not open yet", () => {
	/** The conversation went on, ran to its end and, with nobody viewing it, was closed for being idle. */
	async function closedSuccessor(rig: CoreRig): Promise<Away> {
		const away = await replacedWhileAway(rig, 1);
		rig.fake.fake.release(away.first);
		await quiesce();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([away.first.sessionId]);
		return away;
	}

	/** An adapter whose opens wait for the test, from the moment it `arm`s them. */
	function holdingOpens(): { adapt: (backend: AgentBackend) => AgentBackend; gate: Gate<void>; arm: () => void } {
		const gate = new Gate<void>();
		let armed = false;
		return {
			gate,
			arm: () => {
				armed = true;
			},
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) => {
					if (armed) await gate.hold();
					return backend.open(target, sink);
				},
			}),
		};
	}

	test("is opened by the redirect, once, and the attach that follows finds it open", async () => {
		const rig = await startCoreRig();
		const away = await closedSuccessor(rig);
		const next = away.first;
		const back = await rig.client("back");
		const told = await back.ok("session.attach", { session: away.old, resume: { epoch: away.epoch, seq: away.seq } });
		expect(told.sync).toMatchObject({ kind: "replaced", session: next });
		expect(rig.opens.opened).toEqual([away.old.sessionId, next.sessionId]);
		await back.ok("session.attach", { session: next });
		expect(rig.opens.opened).toEqual([away.old.sessionId, next.sessionId]);
	});

	test("a client that left while the successor opened is answered nothing", async () => {
		const { adapt, gate, arm } = holdingOpens();
		const rig = await startCoreRig({ adapt });
		const away = await closedSuccessor(rig);
		const back = new TestClient(rig.core, "back");
		await back.hello();
		arm();
		const pending = back.sendFrame({
			type: "contract",
			message: {
				type: "session.attach",
				requestId: "late",
				session: away.old,
				resume: { epoch: away.epoch, seq: away.seq },
			},
		});
		await gate.arrived();
		back.close();
		gate.pass();
		await pending;
		expect(back.messages.filter((message) => message.type === "session.attach.result")).toEqual([]);
	});

	test("a client that took back its minor while the successor opened is not told", async () => {
		const { adapt, gate, arm } = holdingOpens();
		const rig = await startCoreRig({ adapt });
		const away = await closedSuccessor(rig);
		const back = await rig.client("back");
		arm();
		const pending = back.request("session.attach", { session: away.old, resume: { epoch: away.epoch, seq: away.seq } });
		await gate.arrived();
		await back.hello(MINOR_ZERO);
		gate.pass();
		expect(await pending).toMatchObject({ error: { code: "invalid_message" } });
	});
});

describe("the memory of replacements", () => {
	const next: SessionRef = { backend: "pi", sessionId: "next" };
	const clock = () => new ManualClock();

	test("follows a chain, and stops at the last link", () => {
		const memory = new Replacements(clock(), undefined);
		memory.record("e1", { backend: "pi", sessionId: "b" }, "e2");
		memory.record("e2", { backend: "pi", sessionId: "c" }, "e3");
		expect(memory.successor("e1")).toEqual({ backend: "pi", sessionId: "c" });
		expect(memory.successor("e2")).toEqual({ backend: "pi", sessionId: "c" });
		expect(memory.successor("e3")).toBeUndefined();
	});

	test("a record that points back at itself, from a damaged journal, ends the chain instead of looping", () => {
		const loop: ReplacementRecord[] = [
			{ epoch: "a", next, nextEpoch: "b", at: 1_700_000_000_000 },
			{ epoch: "b", next: { backend: "pi", sessionId: "other" }, nextEpoch: "a", at: 1_700_000_000_000 },
		];
		const memory = new Replacements(clock(), { load: () => loop, append: () => undefined });
		expect(memory.successor("a")).toEqual({ backend: "pi", sessionId: "other" });
	});

	test("keeps the newest records past its bound, and forgets the oldest", () => {
		const memory = new Replacements(clock(), undefined);
		for (let index = 0; index <= REPLACEMENT_MEMORY; index++) memory.record(`e${index}`, next, `n${index}`);
		expect(memory.successor("e0")).toBeUndefined();
		expect(memory.successor("e1")).toEqual(next);
		expect(memory.successor(`e${REPLACEMENT_MEMORY}`)).toEqual(next);
	});

	test("loads what the journal kept, except what has expired, and writes what it records", () => {
		const time = clock();
		const fresh: ReplacementRecord = { epoch: "fresh", next, nextEpoch: "f2", at: time.now() };
		const stale: ReplacementRecord = { epoch: "stale", next, nextEpoch: "s2", at: time.now() - REPLACEMENT_TTL_MS - 1 };
		const appended: ReplacementRecord[] = [];
		const memory = new Replacements(time, { load: () => [stale, fresh], append: (record) => appended.push(record) });
		expect(memory.successor("fresh")).toEqual(next);
		expect(memory.successor("stale")).toBeUndefined();
		memory.record("added", next, "a2");
		expect(appended).toEqual([{ epoch: "added", next, nextEpoch: "a2", at: time.now() }]);
	});
});
