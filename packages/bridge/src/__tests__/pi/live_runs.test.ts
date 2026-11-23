/**
 * On the real adapter: what an abort leaves, a retry and an error inside a run, and steer and queue idle and mid-run.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { ScriptedRequest } from "../helpers/scripted-openai-server";
import { LiveRig } from "./helpers/live-rig";
import { countOf, holdingRun, lastUserText, userMessages } from "./helpers/live-steps";
import { textOf } from "./helpers/pi-router";
import { failWith, holdAt, say } from "./helpers/scenarios";
import { userTexts } from "./helpers/session-files";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

/** A failure Pi retries: its message names an overloaded provider (pi-ai 1.5.2 `dist/utils/retry.js:208-215`). */
const OVERLOADED = failWith(503, "the provider is overloaded");

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("prompt, abort, prompt", () => {
	test("Stop takes the queued input out of Pi and hands it back, steering first, and the next run carries none of it", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "first");
		for (const [text, mode] of [
			["steer one", "steer"],
			["later one", "queue"],
			["steer two", "steer"],
			["later two", "queue"],
		] as const) {
			expect(await live.prompt(text, mode)).toMatchObject({ status: "accepted" });
		}
		await live.waitFor("queue_changed", (event) => event.items.length === 4);
		const firstRun = live.reduced().run?.runId;
		const stopped = live.recorder.items.length;

		expect((await live.control.abort()).status).toBe("accepted");
		const ended = await live.waitFor("run_finished", (event) => event.runId === firstRun);
		expect(ended.outcome.kind).toBe("aborted");
		await t.driver.quiesce();
		const afterStop = live.events().slice(stopped);
		expect(afterStop.filter((event) => event.type === "input_returned")).toEqual([
			{ type: "input_returned", texts: ["steer one", "steer two", "later one", "later two"] },
		]);
		const emptied = afterStop.findIndex((event) => event.type === "queue_changed" && event.items.length === 0);
		const handedBack = afterStop.findIndex((event) => event.type === "input_returned");
		expect([emptied >= 0, emptied < handedBack]).toEqual([true, true]);
		expect(live.reduced().queue).toEqual([]);
		expect(live.events().some((event) => event.type === "notice" && event.text.includes("not sent"))).toBe(false);

		const mark = live.recorder.items.length;
		t.router.script(live.ref.sessionId, [say("reply to next")]);
		expect(await live.prompt("next")).toEqual({ status: "accepted", disposition: "started" });
		expect((await live.runAfter(mark)).outcome.kind).toBe("completed");
		expect(userMessages(live).map((message) => message.text)).toEqual(["first", "next"]);
		expect(userTexts(t.fileOf(live.ref))).toEqual(["first", "next"]);
		const sent = t.router
			.requests(live.ref.sessionId)
			.at(-1)
			?.messages.map((message) => textOf(message.content));
		expect(sent?.filter((text) => /steer|later/.test(text))).toEqual([]);
		live.assertSettled();
	});

	test("Stop with nothing queued hands nothing back", async () => {
		t = await LiveRig.create();
		const live = await holdingRun(t, {}, "first");
		await live.control.abort();
		await live.waitFor("run_finished");
		expect(live.events().some((event) => event.type === "input_returned")).toBe(false);
		live.assertSettled();
	});

	test("Stop while nothing runs hands nothing back", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		expect((await live.control.abort()).status).toBe("accepted");
		expect(live.events().some((event) => event.type === "input_returned")).toBe(false);
	});
});

describe("a retry inside a run", () => {
	test("a transient failure is one run: one start, retry scheduled then finished, one end", async () => {
		t = await LiveRig.create();
		const live = await t.rig.openNew();
		t.router.script(live.ref.sessionId, [OVERLOADED, say("recovered")]);
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
			Array.from({ length: 4 }, () => OVERLOADED),
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
		t.router.script(live.ref.sessionId, [failWith(400, "the account is closed")]);
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
		const gate = t.router.newGate(live.ref.sessionId);
		t.router.script(live.ref.sessionId, [holdAt(gate, "Working."), say("steered reply"), say("queued reply")]);
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

		t.router.release(live.ref.sessionId);
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

describe("the user's own steering setting", () => {
	/** Two steers sent while the run holds, then the run released; the requests Pi made to the model. */
	async function twoSteers(settings: Record<string, unknown>, script: ReturnType<typeof say>[]) {
		t = await LiveRig.create({ settings });
		const live = await t.rig.openNew();
		const gate = t.router.newGate(live.ref.sessionId);
		t.router.script(live.ref.sessionId, [holdAt(gate, "Working."), ...script]);
		await live.prompt("begin");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		for (const text of ["steer one", "steer two"]) {
			expect(await live.prompt(text, "steer")).toMatchObject({ status: "accepted", disposition: "steered" });
		}
		t.router.release(live.ref.sessionId);
		await live.waitFor("run_finished");
		live.assertSettled();
		return t.router.requests(live.ref.sessionId);
	}

	const userTextsOf = (request: ScriptedRequest | undefined) =>
		(request?.messages ?? []).filter((message) => message.role === "user").map((message) => textOf(message.content));

	test("Pi's default hands steers over one per turn", async () => {
		const requests = await twoSteers({}, [say("first"), say("second")]);
		expect(requests).toHaveLength(3);
		expect(userTextsOf(requests[1])).toEqual(["begin", "steer one"]);
		expect(userTextsOf(requests[2])).toEqual(["begin", "steer one", "steer two"]);
	});

	test("with steeringMode all in the user's settings every steer is handed over at once", async () => {
		const requests = await twoSteers({ steeringMode: "all" }, [say("both")]);
		expect(requests).toHaveLength(2);
		expect(userTextsOf(requests[1])).toEqual(["begin", "steer one", "steer two"]);
	});
});
