import { describe, expect, test } from "bun:test";
import type { AgentBackend, BackendTraits, SessionRef } from "../contract";
import { NO_METHODS } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import { MAX_BRIDGE_QUEUE } from "../core/bridge-queue";
import type { FallbackOptions } from "../core/fallbacks";
import { changedSession, wrappingSessions } from "./helpers/core-adapters";
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
const START_ONLY: BackendTraits = { ...FULL_TRAITS, promptModes: ["start"], queue: false };

/** An adapter whose prompts reach the backend a moment after they are sent, as a process on the other end of a pipe. */
function slowPrompts(backend: AgentBackend): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({
				...control,
				prompt: async (input) => {
					await new Promise((resolve) => setImmediate(resolve));
					return control.prompt(input);
				},
			}),
		}),
	);
}

async function startOnly(fallbacks: FallbackOptions = { queue: true }) {
	const rig = await startCoreRig({ fake: { traits: START_ONLY, methods: NO_METHODS }, core: { fallbacks } });
	const phone = await rig.client("phone");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, HOLD);
	const initial = await attachForSnapshot(phone, session);
	return { rig, phone, session, initial };
}

async function queue(phone: TestClient, session: SessionRef, text: string) {
	return (await phone.ok("prompt", { session, input: promptInput(text, "queue") })).result;
}

function queueSizes(phone: TestClient, session: SessionRef): number[] {
	return phone.events(session).flatMap((event) => (event.type === "queue_changed" ? [event.items.length] : []));
}

function delivered(phone: TestClient, session: SessionRef): string[] {
	return phone.events(session).flatMap((event) => (event.type === "user_message" ? [event.text] : []));
}

async function running(rig: CoreRig, phone: TestClient, session: SessionRef): Promise<void> {
	await phone.ok("prompt", { session, input: promptInput("First") });
	await quiesce();
	expect(rig.fake.fake.delivered(session)?.text).toBe("First");
}

describe("the bridge's queue for a backend without one", () => {
	test("is off unless asked for: the backend refuses a queued prompt and is described as it is", async () => {
		const rig = await startCoreRig({ fake: { traits: START_ONLY, methods: NO_METHODS } });
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		await phone.ok("session.attach", { session });
		expect(await queue(phone, session, "Later")).toMatchObject({ rejection: { code: "unsupported" } });
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities).toMatchObject({ promptModes: ["start"], queue: false });
	});

	test("is described to the phone, holds prompts behind the run, and starts each once the run before it ends", async () => {
		const { rig, phone, session, initial } = await startOnly();
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities).toMatchObject({ promptModes: ["start", "queue"], queue: true });
		expect((await phone.ok("session.attach", { session })).capabilities.cancelQueued).toBe(true);
		await running(rig, phone, session);
		const a = await queue(phone, session, "A");
		const b = await queue(phone, session, "B");
		expect([a, b]).toMatchObject([
			{ status: "accepted", disposition: "queued", queueItemId: expect.any(String) },
			{ status: "accepted", disposition: "queued", queueItemId: expect.any(String) },
		]);
		const late = await attachForSnapshot(await rig.client("late"), session);
		expect(late.queue.map((item) => item.preview)).toEqual(["A", "B"]);
		await phone.ok("session.attach", { session });
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);
		rig.fake.fake.release(session);
		await quiesce();
		expect(delivered(phone, session)).toEqual(["First", "A", "B"]);
		expect(queueSizes(phone, session)).toEqual([1, 2, 1, 0]);
		const advertised = { ...START_ONLY, promptModes: backend?.capabilities.promptModes ?? [], queue: true };
		expect(streamProblems(phone, session, advertised, initial)).toEqual([]);
		expect(rig.log.errors).toEqual([]);
	});

	test("cancels an item once, and an abort gives the rest back to the composer", async () => {
		const { rig, phone, session } = await startOnly();
		await running(rig, phone, session);
		const a = await queue(phone, session, "A");
		await queue(phone, session, "B");
		if (a.status !== "accepted" || !a.queueItemId) throw new Error("A was not queued");
		const queueItemId = a.queueItemId;
		expect((await phone.ok("queue.cancel", { session, queueItemId })).result).toEqual({ status: "accepted" });
		expect((await phone.ok("queue.cancel", { session, queueItemId })).result).toMatchObject({
			rejection: { code: "not_found" },
		});
		expect((await phone.ok("abort", { session })).result).toEqual({ status: "accepted" });
		await quiesce();
		expect(phone.events(session).filter((event) => event.type === "input_returned")).toEqual([
			{ type: "input_returned", texts: ["B"] },
		]);
		expect(queueSizes(phone, session).at(-1)).toBe(0);
		expect(delivered(phone, session)).toEqual(["First"]);
	});

	test("starts a queued prompt at once with no run, and holds no more than its bound", async () => {
		const { phone, session } = await startOnly();
		expect(await queue(phone, session, "Now")).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		expect(delivered(phone, session)).toEqual(["Now"]);
		for (let index = 0; index < MAX_BRIDGE_QUEUE; index++) {
			expect(await queue(phone, session, `q${index}`)).toMatchObject({ disposition: "queued" });
		}
		expect(await queue(phone, session, "one too many")).toMatchObject({ rejection: { code: "busy" } });
	});

	test("once the run it started has ended, the next queued prompt starts at once", async () => {
		const { rig, phone, session } = await startOnly();
		await running(rig, phone, session);
		rig.fake.fake.release(session);
		await quiesce();
		expect(await queue(phone, session, "Next")).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		expect(delivered(phone, session)).toEqual(["First", "Next"]);
	});

	test("two queued prompts sent at once to an idle session start the first and queue the second", async () => {
		const rig = await startCoreRig({
			fake: { traits: START_ONLY, methods: NO_METHODS },
			core: { fallbacks: { queue: true } },
			adapt: slowPrompts,
		});
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await phone.ok("session.attach", { session });
		const [first, second] = await Promise.all([queue(phone, session, "One"), queue(phone, session, "Two")]);
		expect([first, second]).toMatchObject([{ disposition: "started" }, { disposition: "queued" }]);
		rig.fake.fake.release(session);
		await quiesce();
		await quiesce();
		expect(delivered(phone, session)).toEqual(["One", "Two"]);
		expect(rig.log.errors).toEqual([]);
	});

	test("keeps what it queued when a backend that shows its own queue changes it", async () => {
		const steersItself: BackendTraits = { ...FULL_TRAITS, promptModes: ["start", "steer"], queue: true };
		const rig = await startCoreRig({
			fake: { traits: steersItself, methods: NO_METHODS },
			core: { fallbacks: { queue: true } },
		});
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await phone.ok("session.attach", { session });
		await running(rig, phone, session);
		expect(await queue(phone, session, "Queued")).toMatchObject({ disposition: "queued" });
		const dropped = await queue(phone, session, "Dropped");
		const steered = (await phone.ok("prompt", { session, input: promptInput("Steered", "steer") })).result;
		expect(steered).toMatchObject({ disposition: "steered" });
		const previews = () => {
			const last = phone.events(session).findLast((event) => event.type === "queue_changed");
			return last?.type === "queue_changed" ? last.items.map((item) => item.preview) : [];
		};
		expect(previews()).toEqual(["Steered", "Queued", "Dropped"]);
		if (dropped.status !== "accepted" || !dropped.queueItemId) throw new Error("Dropped was not queued");
		await phone.ok("queue.cancel", { session, queueItemId: dropped.queueItemId });
		expect(previews()).toEqual(["Steered", "Queued"]);
		const late = await attachForSnapshot(await rig.client("late"), session);
		expect(late.queue.map((item) => item.preview)).toEqual(["Steered", "Queued"]);
		await phone.ok("session.attach", { session });
		expect(phone.events(session).some((event) => event.type === "resynced")).toBe(false);
		rig.fake.fake.release(session);
		await quiesce();
		expect(delivered(phone, session)).toEqual(["First", "Steered", "Queued"]);
	});

	test("never stands in for a backend that queues itself", async () => {
		const rig = await startCoreRig({ core: { fallbacks: { queue: true, steer: true, portableFork: true } } });
		const phone = await rig.client("phone");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD });
		rig.fake.fake.script(session, HOLD);
		await phone.ok("session.attach", { session });
		await running(rig, phone, session);
		await queue(phone, session, "Native");
		expect(rig.fake.fake.delivered(session)?.text).toBe("First");
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities).toMatchObject({ promptModes: ["start", "steer", "queue"], queue: true, fork: true });
		const steered = (await phone.ok("prompt", { session, input: promptInput("Join", "steer") })).result;
		expect(steered).toMatchObject({ status: "accepted", disposition: "steered" });
		rig.fake.fake.release(session);
		await quiesce();
		const runs = phone.events(session).flatMap((event) => (event.type === "run_started" ? [event.trigger] : []));
		expect(runs).toEqual(["prompt", "queue"]);
	});
});
