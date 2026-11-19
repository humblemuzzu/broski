import { describe, expect, test } from "bun:test";
import type { FakeStep } from "../contract/testing/fake-script";
import type { LinkFeedRunsMessage } from "../server/link-feed/format";
import { LinkRunsTracker } from "../server/link-feed/runs";
import { promptInput, quiesce, RIG_CWD, startCoreRig } from "./helpers/core-rig";

const HOLD: FakeStep[] = [{ kind: "text", text: "Working." }, { kind: "hold" }, { kind: "text", text: "Done." }];

describe("RunClock in BridgeCore", () => {
	test("sessions.list and session.get carry the active run's startedAt and clear it once finished", async () => {
		const rig = await startCoreRig();
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD, title: "Build feature" });
		rig.fake.fake.script(session, HOLD);

		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();

		const started = phone.events(session).find((event) => event.type === "run_started");
		expect(started).toBeDefined();

		const listed = await phone.ok("sessions.list", {
			backend: session.backend,
			query: {},
			page: { limit: 20 },
		});
		if (listed.result.status !== "accepted") throw new Error("expected accepted list");
		const listedRow = listed.result.page.items.find((item) => item.session.sessionId === session.sessionId);
		expect(listedRow?.status).toBe("running");
		expect(listedRow?.runStartedAt).toBeDefined();

		const got = await phone.ok("session.get", { session });
		if (got.result.status !== "accepted") throw new Error("expected accepted get");
		expect(got.result.summary.runStartedAt).toBe(listedRow?.runStartedAt);

		rig.clock.advance(60_000);
		const later = await phone.ok("session.get", { session });
		if (later.result.status !== "accepted") throw new Error("expected accepted get");
		expect(later.result.summary.runStartedAt).toBe(listedRow?.runStartedAt);

		rig.fake.fake.release(session);
		await quiesce();

		const done = await phone.ok("session.get", { session });
		if (done.result.status !== "accepted") throw new Error("expected accepted get");
		expect(done.result.summary.status).toBe("idle");
		expect(done.result.summary.runStartedAt).toBeUndefined();
	});

	test("LinkRunsTracker emits live runs on start, phase changes, and empty on finish", async () => {
		const emitted: LinkFeedRunsMessage[] = [];
		const tracker = new LinkRunsTracker((message) => emitted.push(message));
		const rig = await startCoreRig({
			core: {
				observer: {
					observe: (event) => tracker.observe(event),
					observeCatalog: (event) => tracker.observeCatalog(event),
				},
			},
		});
		const phone = await rig.client("a");
		const session = rig.fake.fake.seed({ cwd: RIG_CWD, title: "Watch me" });
		rig.fake.fake.script(session, HOLD);

		await phone.ok("session.attach", { session });
		await phone.ok("prompt", { session, input: promptInput("Go") });
		await quiesce();

		expect(emitted.some((msg) => msg.runs.length === 1 && msg.runs[0]?.phase === "working")).toBe(true);
		expect(emitted.some((msg) => msg.runs[0]?.title === "Watch me")).toBe(true);

		rig.fake.fake.release(session);
		await quiesce();

		expect(emitted.at(-1)?.runs).toEqual([]);
	});
});
