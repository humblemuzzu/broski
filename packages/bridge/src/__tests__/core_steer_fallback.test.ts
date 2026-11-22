import { describe, expect, test } from "bun:test";
import type { AgentBackend, BackendTraits, SessionRef } from "../contract";
import { NO_METHODS } from "../contract/testing/fake-backend";
import { FULL_TRAITS } from "../contract/testing/fake-data";
import type { FallbackOptions } from "../core/fallbacks";
import { STEER_STOP_MS } from "../core/steer-fallback";
import { changedSession, wrappingSessions } from "./helpers/core-adapters";
import { promptInput, quiesce, RIG_CWD, startCoreRig, type TestClient } from "./helpers/core-rig";

const HOLD = [{ kind: "text" as const, text: "Working." }, { kind: "hold" as const }];
const START_ONLY: BackendTraits = { ...FULL_TRAITS, promptModes: ["start"], queue: false };

async function running(fallbacks: FallbackOptions | undefined, adapt?: (backend: AgentBackend) => AgentBackend) {
	const rig = await startCoreRig({
		fake: { traits: START_ONLY, methods: NO_METHODS },
		...(fallbacks && { core: { fallbacks } }),
		...(adapt && { adapt }),
	});
	const phone = await rig.client("phone");
	const session = rig.fake.fake.seed({ cwd: RIG_CWD });
	rig.fake.fake.script(session, HOLD);
	await phone.ok("session.attach", { session });
	await phone.ok("prompt", { session, input: promptInput("First") });
	await quiesce();
	return { rig, phone, session };
}

function steer(phone: TestClient, session: SessionRef, text: string) {
	return phone.ok("prompt", { session, input: promptInput(text, "steer") });
}

/** An adapter whose abort is accepted at once, and ends the run a moment later. */
function slowAborts(backend: AgentBackend): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({
				...control,
				abort: async () => {
					setImmediate(() => void control.abort());
					return { status: "accepted" };
				},
			}),
		}),
	);
}

/** An adapter whose abort is accepted but leaves the run going. */
function deafToAborts(backend: AgentBackend): AgentBackend {
	return wrappingSessions(backend, (session) =>
		changedSession(session, {
			control: (control) => ({ ...control, abort: async () => ({ status: "accepted" }) }),
		}),
	);
}

describe("steering a backend that cannot join a running run", () => {
	test("is off unless asked for: the backend refuses the steer", async () => {
		const { phone, session } = await running(undefined);
		expect((await steer(phone, session, "Also")).result).toMatchObject({ rejection: { code: "unsupported" } });
	});

	test("stops the run and starts the steer as the next one, keeping what the bridge queued behind it", async () => {
		const { rig, phone, session } = await running({ steer: true, queue: true });
		const [backend] = (await phone.ok("backends.list", {})).backends;
		expect(backend?.capabilities.promptModes).toEqual(["start", "steer", "queue"]);
		const queued = (await phone.ok("prompt", { session, input: promptInput("Later", "queue") })).result;
		expect(queued).toMatchObject({ disposition: "queued" });
		expect((await steer(phone, session, "Also this")).result).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		const finished = phone
			.events(session)
			.flatMap((event) => (event.type === "run_finished" ? [event.outcome.kind] : []));
		expect(finished).toEqual(["aborted", "completed", "completed"]);
		const texts = phone.events(session).flatMap((event) => (event.type === "user_message" ? [event.text] : []));
		expect(texts).toEqual(["First", "Also this", "Later"]);
		expect(phone.events(session).some((event) => event.type === "input_returned")).toBe(false);
		expect(rig.log.errors).toEqual([]);
	});

	test("with no run, the steer simply starts one", async () => {
		const { rig, phone, session } = await running({ steer: true });
		rig.fake.fake.release(session);
		await quiesce();
		expect((await steer(phone, session, "Fresh")).result).toEqual({ status: "accepted", disposition: "started" });
	});

	test("an abort accepted before its run ends is waited out, then the steer starts", async () => {
		const { phone, session } = await running({ steer: true }, slowAborts);
		expect((await steer(phone, session, "After")).result).toEqual({ status: "accepted", disposition: "started" });
		await quiesce();
		const texts = phone.events(session).flatMap((event) => (event.type === "user_message" ? [event.text] : []));
		expect(texts).toEqual(["First", "After"]);
	});

	test("a run that does not stop in time leaves the steer unsent", async () => {
		const { rig, phone, session } = await running({ steer: true }, deafToAborts);
		const answer = steer(phone, session, "Too late");
		await quiesce();
		rig.clock.advance(STEER_STOP_MS - 1);
		await quiesce();
		expect(rig.fake.fake.delivered(session)?.text).toBe("First");
		rig.clock.advance(1);
		expect((await answer).result).toMatchObject({ rejection: { code: "busy" } });
		expect(rig.fake.fake.delivered(session)?.text).toBe("First");
	});
});
