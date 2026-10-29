import { describe, expect, test } from "bun:test";
import type { AgentBackend, OpenResult } from "../contract";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { SESSION_CALL_DEADLINE_MS } from "../core/deadline";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import { changedSession, Gate, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, streamProblems, TestClient } from "./helpers/core-rig";

/** The fake, with every `close` held until the test lets it finish. */
function gatedCloses(gate: Gate<void>): (backend: AgentBackend) => AgentBackend {
	return (backend) =>
		wrappingSessions(backend, (session) =>
			changedSession(session, {
				close: async () => {
					await gate.hold();
					await session.close();
				},
			}),
		);
}

/** The fake, with every `open` held until the test lets it through. */
function gatedOpens(gate: Gate<void>): (backend: AgentBackend) => AgentBackend {
	return (backend) => ({
		...backend,
		open: async (target, sink): Promise<OpenResult> => {
			await gate.hold();
			return backend.open(target, sink);
		},
	});
}

describe("the core's session lifecycle", () => {
	test("a session stays open while it runs and nobody views it, and closes once idle after the delay", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "text", text: "Working." }, { kind: "hold" }]);
		const first = await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		await a.ok("session.detach", { session });
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([]);
		rig.fake.fake.release(session);
		await quiesce();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS - 1);
		expect(rig.opens.closed).toEqual([]);
		rig.clock.advance(1);
		expect(rig.opens.closed).toEqual([session.sessionId]);
		const again = await a.ok("session.attach", { session });
		expect(again.sync.epoch).not.toBe(first.sync.epoch);
		expect(rig.opens.opened).toEqual([session.sessionId, session.sessionId]);
	});

	test("a viewer coming back within the delay keeps the session open; one that leaves lets it close", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const first = await a.ok("session.attach", { session });
		await a.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS / 2);
		const again = await a.ok("session.attach", { session });
		rig.clock.advance(10 * DEFAULT_IDLE_CLOSE_MS);
		expect(again.sync.epoch).toBe(first.sync.epoch);
		expect(rig.opens.closed).toEqual([]);
		a.close();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("concurrent attaches share one open, and an attach right after a close waits for it", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const [one, two] = await Promise.all([a.ok("session.attach", { session }), b.ok("session.attach", { session })]);
		expect(one.sync.epoch).toBe(two.sync.epoch);
		expect(rig.opens.opened).toEqual([session.sessionId]);
		a.close();
		b.close();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		const c = await rig.client("c");
		await c.ok("session.attach", { session });
		expect(rig.opens.opened).toEqual([session.sessionId, session.sessionId]);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("a session is not opened again until its previous close has finished", async () => {
		const gate = new Gate<void>();
		const rig = await startCoreRig({ adapt: gatedCloses(gate) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await a.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(gate.count()).toBe(1);
		const attaching = a.ok("session.attach", { session });
		await quiesce();
		expect(rig.opens.opened).toEqual([session.sessionId]);
		gate.pass();
		await attaching;
		expect(rig.opens.opened).toEqual([session.sessionId, session.sessionId]);
	});

	test("a close that never finishes is waited for no longer than the deadline", async () => {
		const gate = new Gate<void>();
		const rig = await startCoreRig({ adapt: gatedCloses(gate) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await a.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		const attaching = a.ok("session.attach", { session });
		await quiesce();
		rig.clock.advance(SESSION_CALL_DEADLINE_MS - 1);
		await quiesce();
		expect(rig.opens.opened).toEqual([session.sessionId]);
		rig.clock.advance(1);
		await attaching;
		expect(rig.opens.opened).toEqual([session.sessionId, session.sessionId]);
		expect(rig.log.errors.some((line) => line.includes("did not close the session within"))).toBe(true);
	});

	test("an open past the deadline fails, and the session it brings later is closed before the next open", async () => {
		const gate = new Gate<void>();
		const rig = await startCoreRig({ adapt: gatedOpens(gate) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const first = a.request("session.attach", { session });
		await gate.arrived();
		rig.clock.advance(SESSION_CALL_DEADLINE_MS);
		expect(await first).toMatchObject({
			error: { code: "internal", message: expect.stringContaining("backend_error") },
		});
		const second = a.ok("session.attach", { session });
		await quiesce();
		expect(gate.count()).toBe(1);
		gate.pass();
		await quiesce();
		expect(rig.opens.opened).toEqual([session.sessionId]);
		expect(rig.opens.closed).toEqual([session.sessionId]);
		gate.pass();
		await second;
		expect(rig.opens.opened).toEqual([session.sessionId, session.sessionId]);
	});

	test("a created session closes on its own unless someone attaches", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const created = await a.ok("session.create", { backend: "pi", options: { cwd: RIG_CWD } });
		if (created.result.status !== "accepted") throw new Error("not created");
		const session = created.result.session;
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
		const kept = await a.ok("session.create", { backend: "pi", options: { cwd: RIG_CWD } });
		if (kept.result.status !== "accepted") throw new Error("not created");
		const answer = await a.ok("session.attach", { session: kept.result.session });
		expect(answer.sync).toMatchObject({ kind: "snapshot", lastSeq: 0 });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("a replaced session ends its stream with session_replaced, and the live session goes on under the new id", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "text", text: "Before." }, { kind: "replace_session" }, { kind: "hold" }]);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Clear") });
		await quiesce();
		const last = a.events(session).at(-1);
		if (last?.type !== "session_replaced") throw new Error(`the old stream ended with ${last?.type}`);
		const next = last.session;
		expect(await a.request("abort", { session })).toMatchObject({ error: { code: "not_attached" } });
		const answer = await a.ok("session.attach", { session: next });
		if (answer.sync.kind !== "snapshot") throw new Error("expected a snapshot");
		expect(answer.sync.snapshot.run).toBeDefined();
		expect(answer.sync.lastSeq).toBe(0);
		rig.fake.fake.release(next);
		await quiesce();
		const after = a.envelopes(next);
		expect(after[0]?.seq).toBe(1);
		expect(after.at(-1)?.event.type).toBe("run_finished");
		expect(streamProblems(a, next, FULL_TRAITS, answer.sync.snapshot)).toEqual([]);
	});

	test("deleting a viewed session ends its stream and lets its viewers go", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const b = await rig.client("b");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await a.ok("session.attach", { session });
		await b.ok("session.attach", { session });
		expect((await a.ok("session.delete", { session })).result.status).toBe("accepted");
		expect(b.catalog().at(-1)?.event).toEqual({ type: "session_removed", session });
		expect(await b.request("prompt", { session, input: promptInput("x") })).toMatchObject({
			error: { code: "not_attached" },
		});
		expect(rig.opens.closed).toContain(session.sessionId);
		expect(await a.request("session.attach", { session })).toMatchObject({ error: { code: "unknown_session" } });
	});

	test("a session deleted while it waits to close for being idle closes once", async () => {
		const rig = await startCoreRig();
		const a = await rig.client("a");
		const created = await a.ok("session.create", { backend: "pi", options: { cwd: RIG_CWD } });
		if (created.result.status !== "accepted") throw new Error("not created");
		const session = created.result.session;
		await a.ok("session.delete", { session });
		expect(rig.opens.closed).toEqual([session.sessionId]);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("dispose disposes the backends and ends every stream, busy or not", async () => {
		let disposed = 0;
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				dispose: () => {
					disposed += 1;
					return backend.dispose();
				},
			}),
		});
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "hold" }]);
		await a.ok("session.attach", { session });
		await a.ok("prompt", { session, input: promptInput("Busy") });
		await rig.core.dispose();
		expect(disposed).toBe(1);
		const seen = a.messages.length;
		rig.fake.fake.release(session);
		await quiesce();
		expect(a.messages).toHaveLength(seen);
		expect(await a.request("backends.list", {})).toMatchObject({ backends: [] });
		expect(rig.clock.pending()).toBe(0);
	});

	test("an open that lands as the bridge stops is closed, and the attach is answered", async () => {
		const gate = new Gate<void>();
		const rig = await startCoreRig({ adapt: gatedOpens(gate) });
		const a = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const attaching = a.request("session.attach", { session });
		await gate.arrived();
		const disposing = rig.core.dispose();
		gate.pass();
		expect(await attaching).toMatchObject({ error: { code: "internal", message: expect.stringContaining("closed") } });
		await disposing;
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});

	test("an attach that arrives after its client left neither answers nor keeps the session", async () => {
		const rig = await startCoreRig();
		const a = new TestClient(rig.core, "a");
		await a.hello();
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const pending = a.sendFrame({ type: "contract", message: { type: "session.attach", requestId: "late", session } });
		a.close();
		await pending;
		expect(a.messages.filter((message) => message.type === "session.attach.result")).toEqual([]);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		expect(rig.opens.closed).toEqual([session.sessionId]);
	});
});
