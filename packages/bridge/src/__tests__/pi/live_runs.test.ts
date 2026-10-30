/**
 * On the real adapter: what an abort leaves, a retry and an error inside a run,
 * steer and queue idle and mid-run, and an abort against a provider that ignores its signal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { ABORT_DEADLINE_MS } from "../../backends/pi/live/shutdown";
import { LiveRig } from "./helpers/live-rig";
import { countOf, holdingRun, lastUserText, userMessages } from "./helpers/live-steps";
import { failWith, holdAt, OVERLOADED, say } from "./helpers/scenarios";
import { userTexts } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("prompt, abort, prompt", () => {
	test("an abort leaves the queued follow-up shown, and the next run delivers it once, after its own prompt", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "first");
		const queued = await live.prompt("later", "queue", "11111111-1111-4111-8111-111111111111");
		if (queued.status !== "accepted" || queued.queueItemId === undefined)
			throw new Error("the follow-up was not queued");
		const queueItemId = queued.queueItemId;
		await live.waitFor("queue_changed", (event) => event.items.some((item) => item.id === queueItemId));
		const firstRun = live.reduced().run?.runId;

		expect((await live.control.abort()).status).toBe("accepted");
		const ended = await live.waitFor("run_finished", (event) => event.runId === firstRun);
		expect(ended.outcome.kind).toBe("aborted");
		await t.driver.quiesce();
		expect(live.reduced().queue.map((item) => item.id)).toEqual([queueItemId]);

		const mark = live.recorder.items.length;
		t.router.script(live.ref.sessionId, [say("reply to next"), say("reply to later")]);
		const next = await live.prompt("next");
		expect(next).toEqual({ status: "accepted", disposition: "started" });
		const run = await live.runAfter(mark);
		expect(run.outcome.kind).toBe("completed");
		expect(
			live
				.events()
				.slice(mark)
				.filter((event) => event.type === "run_started"),
		).toHaveLength(1);
		expect(userMessages(live).map((message) => message.text)).toEqual(["first", "next", "later"]);
		expect(userMessages(live).at(-1)?.clientRequestId).toBe("11111111-1111-4111-8111-111111111111");
		expect(live.reduced().queue).toEqual([]);
		expect(userTexts(t.fileOf(live.ref))).toEqual(["first", "next", "later"]);
		live.assertSettled();
	});

	test("a steer pending at the abort is delivered into the aborted run, which still ends aborted, and never into the next", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "first");
		const steered = await live.prompt("steer now", "steer");
		expect(steered).toMatchObject({ status: "accepted", disposition: "steered" });
		await live.control.abort();
		const ended = await live.waitFor("run_finished");
		expect(ended.outcome.kind).toBe("aborted");
		await t.driver.quiesce();
		expect(live.reduced().queue).toEqual([]);

		const mark = live.recorder.items.length;
		await t.rig.arrange(live.ref, { kind: "reply" });
		await live.run("next");
		const delivered = userMessages(live).map((message) => message.text);
		expect(delivered.filter((text) => text === "steer now")).toHaveLength(1);
		expect(
			live
				.events()
				.slice(mark)
				.filter((event) => event.type === "user_message"),
		).toHaveLength(1);
		live.assertSettled();
	});
});

describe("a retry inside a run", () => {
	test("a transient failure is one run: one start, retry scheduled then finished, one end", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [failWith(OVERLOADED), say("recovered")]);
		const { outcome } = await live.run("go");
		expect(outcome.kind).toBe("completed");
		const kinds = live
			.events()
			.map((event) => event.type)
			.filter((type) => ["run_started", "retry_scheduled", "retry_finished", "run_finished"].includes(type));
		expect(kinds).toEqual(["run_started", "retry_scheduled", "retry_finished", "run_finished"]);
		const scheduled = live.events().find((event) => event.type === "retry_scheduled");
		expect(scheduled).toMatchObject({ attempt: 1 });
		expect(scheduled?.type === "retry_scheduled" && scheduled.message.toLowerCase()).toContain("overloaded");
		expect(live.events().find((event) => event.type === "retry_finished")).toEqual({
			type: "retry_finished",
			succeeded: true,
		});
		expect(live.reduced().retry).toBeUndefined();
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(2);
		expect(live.events().some((event) => event.type === "block_finished" && event.text === "recovered")).toBe(true);
		live.assertSettled();
	});

	test("a failure that outlasts the retries ends the run in error once, with the provider's message", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(
			live.ref.sessionId,
			Array.from({ length: 4 }, () => failWith(OVERLOADED)),
		);
		const { outcome } = await live.run("go");
		expect(outcome.kind === "error" && outcome.error.message).toContain("overloaded");
		expect(live.events().filter((event) => event.type === "retry_scheduled")).toHaveLength(3);
		expect(live.events().filter((event) => event.type === "retry_finished")).toEqual([
			{ type: "retry_finished", succeeded: false },
		]);
		expect(countOf(live, "run_started")).toBe(1);
		expect(countOf(live, "run_finished")).toBe(1);
		live.assertSettled();
	});
});

describe("an error run", () => {
	test("ends failed with the provider's message, is not retried, and leaves the session usable", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [failWith("the account is closed")]);
		const { outcome } = await live.run("go");
		expect(outcome.kind).toBe("error");
		expect(outcome.kind === "error" && outcome.error.message).toContain("the account is closed");
		expect(live.events().some((event) => event.type === "retry_scheduled")).toBe(false);
		expect(live.reduced().lastOutcome?.kind).toBe("error");
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(1);
		live.assertSettled();

		await t.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("again")).outcome.kind).toBe("completed");
	});
});

describe("steer and queue", () => {
	test.each(["steer", "queue"] as const)("%s with no run starts one", async (mode) => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		await t.rig.arrange(live.ref, { kind: "reply" });
		const mark = live.recorder.items.length;
		const result = await live.prompt("Begin.", mode);
		expect(result).toEqual({ status: "accepted", disposition: "started" });
		expect((await live.runAfter(mark)).outcome.kind).toBe("completed");
		live.assertSettled();
	});

	test("mid-run, a steer reaches the next request and a queued prompt the one after, in the same run", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		const gate = t.bus.newGate(live.ref.sessionId);
		t.router.script(live.ref.sessionId, [
			holdAt(gate, fauxText("Working.")),
			say("steered reply"),
			say("queued reply"),
		]);
		const steerId = crypto.randomUUID();
		const queueId = crypto.randomUUID();
		await live.prompt("begin");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		const steered = await live.prompt("steer now", "steer", steerId);
		const queued = await live.prompt("queue after", "queue", queueId);
		expect(steered).toMatchObject({ status: "accepted", disposition: "steered" });
		expect(queued).toMatchObject({ status: "accepted", disposition: "queued" });
		const shown = await live.waitFor("queue_changed", (event) => event.items.length === 2);
		expect(shown.items.map((item) => [item.delivery, item.clientRequestId])).toEqual([
			["steer", steerId],
			["queue", queueId],
		]);

		t.bus.release(live.ref.sessionId);
		await live.waitFor("run_finished");
		const requests = t.router.requests(live.ref.sessionId);
		expect(requests).toHaveLength(3);
		expect(lastUserText(requests[1])).toBe("steer now");
		expect(lastUserText(requests[2])).toBe("queue after");
		expect(userMessages(live)).toEqual([
			{ text: "begin", clientRequestId: expect.any(String) },
			{ text: "steer now", clientRequestId: steerId },
			{ text: "queue after", clientRequestId: queueId },
		]);
		expect(countOf(live, "run_started")).toBe(1);
		expect(live.reduced().queue).toEqual([]);
		live.assertSettled();
	});
});

describe("abort against a provider that ignores its signal", () => {
	test(
		"is answered within the deadline, the run stays open until the provider returns, then ends aborted",
		async () => {
			t = await LiveRig.create({ waitMs: ABORT_DEADLINE_MS * 3 });
			const live = await t.rig.openNew();
			const entered = Promise.withResolvers<void>();
			const unblock = Promise.withResolvers<void>();
			t.router.script(live.ref.sessionId, [
				async () => {
					entered.resolve();
					await unblock.promise;
					return fauxAssistantMessage("too late");
				},
			]);
			await live.prompt("go");
			await entered.promise;
			const began = performance.now();
			const aborted = await live.control.abort();
			const waited = performance.now() - began;
			expect(aborted.status).toBe("accepted");
			expect(waited).toBeLessThan(ABORT_DEADLINE_MS + 3_000);
			expect(live.reduced().run).toBeDefined();

			unblock.resolve();
			const ended = await live.waitFor("run_finished");
			expect(ended.outcome.kind).toBe("aborted");
			live.assertSettled();
		},
		ABORT_DEADLINE_MS * 6,
	);
});
