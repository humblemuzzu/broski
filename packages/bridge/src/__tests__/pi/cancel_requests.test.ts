/**
 * Stopping a compaction, or the wait before a retry, on its own: on a real Pi session the run, the queue and the rest of
 * the session carry on, where Stop would end them. A summary or a retried request is held by the faux model until the
 * test releases it or Pi aborts it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { sessionCapabilities } from "../../contract";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { LiveRig } from "./helpers/live-rig";
import { holdingRun } from "./helpers/live-steps";
import { failWith, heldAnswer, OVERLOADED, say } from "./helpers/scenarios";
import { sessionEntries } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("cancelling a compaction", () => {
	test("ends the compaction alone: it finishes aborted, nothing is written, and the session works on", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("Something to compact.");

		t.router.scriptSummaries([heldAnswer(t.bus, live.ref.sessionId, "A summary.")]);
		const mark = live.recorder.items.length;
		expect((await live.control.compact?.(undefined))?.status).toBe("accepted");
		await live.waitFor("compaction_started", () => true, mark);
		await t.bus.entered(live.ref.sessionId);

		expect((await live.control.cancelCompaction?.())?.status).toBe("accepted");
		const finished = await live.waitFor("compaction_finished", () => true, mark);
		expect(finished.outcome).toEqual({ kind: "aborted" });
		const ended = await live.waitFor("run_finished", () => true, mark);
		expect(ended.outcome.kind).toBe("aborted");
		expect(live.reduced().compaction).toBeUndefined();
		live.assertSettled();
		expect(sessionEntries(t.fileOf(live.ref)).filter((entry) => entry.type === "compaction")).toEqual([]);

		t.router.script(live.ref.sessionId, [say("Still here.")]);
		expect((await live.run("Are you there?")).outcome.kind).toBe("completed");
	});

	test("leaves the run it interrupted going, where Stop would end it", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.tiny) });
		t.router.script(live.ref.sessionId, [say("x".repeat(16_000))]);
		t.router.scriptSummaries([heldAnswer(t.bus, live.ref.sessionId, "A summary.")]);
		const result = await live.prompt("fill the window");
		expect(result.status).toBe("accepted");
		await live.waitFor("compaction_started", (event) => event.trigger === "auto");
		await t.bus.entered(live.ref.sessionId);

		expect((await live.control.cancelCompaction?.())?.status).toBe("accepted");
		await live.waitFor("compaction_finished", () => true);
		const ended = await live.waitFor("run_finished", () => true);
		expect(ended.outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test("with no compaction under way is accepted and silent", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t);
		const mark = live.recorder.items.length;

		expect((await live.control.cancelCompaction?.())?.status).toBe("accepted");
		await t.driver.quiesce();
		expect(live.recorder.items.length).toBe(mark);
		expect(live.reduced().run).toBeDefined();
		await live.control.abort();
		await live.waitFor("run_finished");
	});
});

describe("cancelling a retry", () => {
	test("ends the wait before the next attempt: the retry finishes unsuccessfully and the run ends in the provider's error", async () => {
		t = await LiveRig.create({ settings: { retry: { baseDelayMs: 600_000 } } });
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [failWith(OVERLOADED), say("recovered")]);
		const result = await live.prompt("go");
		expect(result.status).toBe("accepted");
		await live.waitFor("retry_scheduled");

		expect((await live.control.cancelRetry?.())?.status).toBe("accepted");
		expect(await live.waitFor("retry_finished", () => true)).toEqual({ type: "retry_finished", succeeded: false });
		const ended = await live.waitFor("run_finished", () => true);
		expect(ended.outcome.kind === "error" && ended.outcome.error.message).toContain("overloaded");
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(1);
		expect(live.reduced().retry).toBeUndefined();
		live.assertSettled();
	});

	test("is stale once the next attempt is running, which only Stop ends", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [failWith(OVERLOADED), heldAnswer(t.bus, live.ref.sessionId, "recovered")]);
		await live.prompt("go");
		await live.waitFor("retry_scheduled");
		await t.bus.entered(live.ref.sessionId);

		const late = await live.control.cancelRetry?.();
		expect(late?.status === "rejected" && late.rejection.code).toBe("stale");
		expect(live.reduced().retry).toBeDefined();
		expect((await live.control.abort()).status).toBe("accepted");
		const ended = await live.waitFor("run_finished", () => true);
		expect(ended.outcome.kind).toBe("aborted");
		live.assertSettled();
	});

	test("with no retry scheduled is accepted and silent", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const mark = live.recorder.items.length;
		expect((await live.control.cancelRetry?.())?.status).toBe("accepted");
		await t.driver.quiesce();
		expect(live.recorder.items.length).toBe(mark);
	});
});

describe("who can cancel", () => {
	test("a session this bridge runs announces both; a closed one refuses; a watch-only one has neither", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		expect(sessionCapabilities(live.session)).toMatchObject({ cancelCompaction: true, cancelRetry: true });
		const control = live.control;
		await live.close();
		const closed = await control.cancelCompaction?.();
		expect(closed?.status === "rejected" && closed.rejection.code).toBe("closed");
		const closedRetry = await control.cancelRetry?.();
		expect(closedRetry?.status === "rejected" && closedRetry.rejection.code).toBe("closed");
	});
});
