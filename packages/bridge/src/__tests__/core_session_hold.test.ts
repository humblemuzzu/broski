/**
 * `BridgeCore.hold` and `release` (core README §20): a session pinned open with no client attached, so an ask raised on
 * it keeps it open, reaches the observer and can be answered from outside the phones, while the core answers nothing.
 */

import { describe, expect, test } from "bun:test";
import type { SessionRef } from "../contract";
import type { FakeStep } from "../contract/testing/fake-script";
import { DEFAULT_IDLE_CLOSE_MS } from "../core/keep-open";
import type { ObservedEvent } from "../core/observer";
import { quiesce, RIG_CWD, startCoreRig } from "./helpers/core-rig";

const ASKING: FakeStep[] = [{ kind: "ask", title: "Run the tests?", request: { kind: "confirm" } }];

async function rigWithObserver() {
	const observed: ObservedEvent[] = [];
	const rig = await startCoreRig({ core: { observer: { observe: (event) => void observed.push(event) } } });
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	return { rig, session, observed };
}

const closedTimes = (closed: string[], session: SessionRef) => closed.filter((id) => id === session.sessionId).length;

describe("holding a session", () => {
	test("opens it with no client attached and keeps it open while held, idle or not", async () => {
		const { rig, session } = await rigWithObserver();
		expect(await rig.core.hold(session)).toEqual({ status: "accepted" });
		expect(rig.opens.opened).toEqual([session.sessionId]);
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
	});

	test("lets an ask raised on it reach the observer, keep it open after the release, and be answered", async () => {
		const { rig, session, observed } = await rigWithObserver();
		await rig.core.hold(session);
		rig.fake.fake.runExternally(session, "From the terminal.", ASKING);
		await quiesce();
		const asked = observed.find((entry) => entry.event.type === "interaction_requested");
		if (asked?.event.type !== "interaction_requested") throw new Error("the ask was not observed");

		rig.core.release(session);
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		expect(observed.some((entry) => entry.event.type === "interaction_resolved")).toBe(false);

		const answer = { interactionId: asked.event.interaction.id, reply: { kind: "confirm", confirmed: true } } as const;
		expect(await rig.core.answer(session, answer)).toEqual({ status: "accepted" });
		await quiesce();
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(closedTimes(rig.opens.closed, session)).toBe(1);
	});

	test("of a session already open and about to close for being idle keeps it open", async () => {
		const { rig, session } = await rigWithObserver();
		const phone = await rig.client("phone");
		await phone.ok("session.attach", { session });
		await phone.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS - 1);
		await rig.core.hold(session);
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.opened).toEqual([session.sessionId]);
		expect(rig.opens.closed).toEqual([]);
	});

	test("is counted: the session closes, once idle, only when every hold is released", async () => {
		const { rig, session } = await rigWithObserver();
		await rig.core.hold(session);
		await rig.core.hold(session);
		expect(rig.opens.opened).toEqual([session.sessionId]);
		rig.core.release(session);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		rig.core.release(session);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS - 1);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		rig.clock.advance(1);
		await quiesce();
		expect(closedTimes(rig.opens.closed, session)).toBe(1);
	});

	test("released more often than held, holds nothing: the next hold and release close it as usual", async () => {
		const { rig, session } = await rigWithObserver();
		rig.core.release(session);
		await rig.core.hold(session);
		rig.core.release(session);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(closedTimes(rig.opens.closed, session)).toBe(1);
	});

	test("of a session the backend does not have is refused, and holds nothing after", async () => {
		const { rig } = await rigWithObserver();
		const missing = { backend: "pi", sessionId: crypto.randomUUID() } as const;
		const refused = await rig.core.hold(missing);
		expect(refused.status === "rejected" && refused.rejection.code).toBe("not_found");

		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await rig.core.hold({ ...missing });
		await phone.ok("session.attach", { session });
		await phone.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(closedTimes(rig.opens.closed, session)).toBe(1);
		expect(rig.opens.opened).toEqual([session.sessionId]);
	});

	test("whose open fails takes the hold back, so the session closes once a phone has viewed it", async () => {
		let failing = true;
		const rig = await startCoreRig({
			adapt: (backend) => ({
				...backend,
				open: async (target, sink) =>
					failing
						? { status: "rejected", rejection: { code: "backend_error", message: "not now" } }
						: backend.open(target, sink),
			}),
		});
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		const refused = await rig.core.hold(session);
		expect(refused.status === "rejected" && refused.rejection.code).toBe("backend_error");
		failing = false;
		const phone = await rig.client("phone");
		await phone.ok("session.attach", { session });
		await phone.ok("session.detach", { session });
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(closedTimes(rig.opens.closed, session)).toBe(1);
	});

	test("follows its session when the backend replaces it, until the old ref's release lets the new one go", async () => {
		const { rig, session } = await rigWithObserver();
		await rig.core.hold(session);
		await rig.core.hold(session);
		rig.fake.fake.runExternally(session, "Clear it.", [{ kind: "replace_session" }]);
		await quiesce();
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		rig.core.release(session);
		rig.clock.advance(100 * DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toEqual([]);
		rig.core.release(session);
		rig.clock.advance(DEFAULT_IDLE_CLOSE_MS);
		await quiesce();
		expect(rig.opens.closed).toHaveLength(1);
	});

	test("of a backend the bridge does not serve is refused not_found", async () => {
		const { rig } = await rigWithObserver();
		const refused = await rig.core.hold({ backend: "claude-code", sessionId: "s" });
		expect(refused.status === "rejected" && refused.rejection.code).toBe("not_found");
	});

	test("does not outlive the bridge: shutdown closes a held session", async () => {
		const { rig, session } = await rigWithObserver();
		await rig.core.hold(session);
		rig.fake.fake.runExternally(session, "From the terminal.", ASKING);
		await quiesce();
		await rig.core.dispose();
		const answer = { interactionId: "any", reply: { kind: "confirm", confirmed: true } } as const;
		const after = await rig.core.answer(session, answer);
		expect(after.status === "rejected" && after.rejection).toEqual({
			code: "not_found",
			message: "the session is not open",
		});
		const again = await rig.core.hold(session);
		expect(again.status === "rejected" && again.rejection.code).toBe("not_found");
	});
});
