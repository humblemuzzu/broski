import { describe, expect, test } from "bun:test";
import type { AgentBackend, SessionSummary } from "../contract";
import type { FakeStep } from "../contract/testing/fake-script";
import { SESSION_CALL_DEADLINE_MS } from "../core/deadline";
import type { ObservedEvent } from "../core/observer";
import { Gate } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig } from "./helpers/core-rig";

const HOLD: FakeStep[] = [{ kind: "text", text: "Working." }, { kind: "hold" }, { kind: "text", text: "Done." }];

function recorded(): { observed: ObservedEvent[]; observer: { observe(observed: ObservedEvent): void } } {
	const observed: ObservedEvent[] = [];
	return { observed, observer: { observe: (event) => void observed.push(event) } };
}

describe("the core's observer", () => {
	test("it sees every event of an open session with the state before and after, viewed or not", async () => {
		const { observed, observer } = recorded();
		const rig = await startCoreRig({ core: { observer } });
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		await phone.ok("session.detach", { session });
		const before = observed.length;
		rig.fake.fake.release(session);
		await quiesce();

		const started = observed.find((entry) => entry.event.type === "run_started");
		expect(started?.before.run).toBeUndefined();
		expect(started?.after.run).toBeDefined();
		const finished = observed.find((entry) => entry.event.type === "run_finished");
		expect(observed.indexOf(finished as ObservedEvent)).toBeGreaterThanOrEqual(before);
		expect(finished?.before.run?.items.some((item) => item.kind === "block" && item.text === "Done.")).toBe(true);
		expect(finished?.after.run).toBeUndefined();
		expect(finished?.session).toEqual(session);
		expect(rig.log.errors).toEqual([]);
	});

	test("an event the core makes itself, a resync, is observed once like the adapter's", async () => {
		const { observed, observer } = recorded();
		const rig = await startCoreRig({ core: { observer } });
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		rig.fake.fake.resync(session);
		await quiesce();
		expect(observed.map((entry) => entry.event.type)).toEqual(["resynced"]);
		const sent = phone.events(session).map((event) => event.type);
		expect(sent).toEqual(["resynced"]);
	});

	test("describe gives the session's row as its backend has it, and nothing when it cannot", async () => {
		const { observed, observer } = recorded();
		const rig = await startCoreRig({ core: { observer } });
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD, title: "Fix the build" });
		await phone.ok("session.attach", { session });
		rig.fake.fake.resync(session);
		await quiesce();
		const summary = await observed[0]?.describe();
		expect(summary?.cwd).toBe(RIG_CWD);
		expect(summary?.title?.text).toBe("Fix the build");
	});

	test("a backend that throws, rejects or answers with a broken row leaves describe empty", async () => {
		const rows: Array<[string, (backend: AgentBackend) => AgentBackend]> = [
			[
				"throws",
				(backend) => ({
					...backend,
					getSession: async () => {
						throw new Error("kaput");
					},
				}),
			],
			[
				"rejects",
				(backend) => ({
					...backend,
					getSession: async () => ({ status: "rejected", rejection: { code: "not_found", message: "gone" } }),
				}),
			],
			[
				"breaks the contract",
				(backend) => ({
					...backend,
					getSession: async (ref) => ({
						status: "accepted",
						summary: { session: ref, archived: "no" } as unknown as SessionSummary,
					}),
				}),
			],
		];
		for (const [name, adapt] of rows) {
			const { observed, observer } = recorded();
			const rig = await startCoreRig({ core: { observer }, adapt });
			const phone = await rig.client("a");
			const session = rig.fake.fake.seed({ cwd: RIG_CWD });
			await phone.ok("session.attach", { session });
			rig.fake.fake.resync(session);
			await quiesce();
			expect([name, await observed[0]?.describe()]).toEqual([name, undefined]);
		}
	});

	test("describe gives up on a backend that never answers, and finds nothing once the backends are gone", async () => {
		const gate = new Gate<never>();
		const { observed, observer } = recorded();
		const rig = await startCoreRig({
			core: { observer },
			adapt: (backend) => ({ ...backend, getSession: () => gate.hold() }),
		});
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		rig.fake.fake.resync(session);
		await quiesce();
		const waiting = observed[0]?.describe();
		await gate.arrived();
		rig.clock.advance(SESSION_CALL_DEADLINE_MS);
		expect(await waiting).toBeUndefined();

		await rig.core.dispose();
		expect(await observed[0]?.describe()).toBeUndefined();
		expect(rig.log.errors).toEqual([]);
	});

	test("an observer that throws costs the events nothing and is logged", async () => {
		const rig = await startCoreRig({
			core: {
				observer: {
					observe: () => {
						throw new Error("observer kaput");
					},
				},
			},
		});
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		expect(phone.events(session).at(-1)).toMatchObject({ type: "run_finished", outcome: { kind: "completed" } });
		expect(rig.log.errors.some((line) => line.includes("the observer failed on run_started"))).toBe(true);
	});

	test("a session that was replaced is observed under its new id afterwards", async () => {
		const { observed, observer } = recorded();
		const rig = await startCoreRig({ core: { observer } });
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, [{ kind: "replace_session" }, { kind: "text", text: "After." }]);
		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();
		const replaced = observed.find((entry) => entry.event.type === "session_replaced");
		if (replaced?.event.type !== "session_replaced") throw new Error("the replacement was not observed");
		expect(replaced.session).toEqual(session);
		const last = observed.at(-1);
		expect(last?.session).toEqual(replaced.event.session);
	});
});
