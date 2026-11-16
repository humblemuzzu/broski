/**
 * The races of a live session: an abort while a prompt is still being
 * decided, a prompt while Pi settles a run, two prompts at once, open/close/open, and shutdown while a
 * prompt waits. Scripted provider, the real adapter on the real `pi`, an extension that parks Pi's handlers on command.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { stopHolders } from "../../backends/pi/holder/holders";
import { MAX_LIST_ITEMS } from "../../contract";
import { countOf, userMessages } from "./helpers/live-steps";
import { askHuman, call, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("an abort while a prompt is being decided", () => {
	test("in an input handler: the run the prompt then starts ends aborted, before its model is asked", async () => {
		t = await HostRig.create();
		const gate = t.gate("inputGate");
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		const prompting = live.prompt("go");
		await gate.entered.promise;

		const aborting = live.control.abort();
		gate.open();

		expect(await prompting).toMatchObject({ status: "accepted", disposition: "started" });
		const finished = await live.waitFor("run_finished");
		expect(finished.outcome.kind).toBe("aborted");
		expect((await aborting).status).toBe("accepted");
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(0);
		live.assertSettled();
	});

	// Pi answers `started` before its `before_agent_start` handlers run, and an abort while they run finds no agent
	// to stop yet (pi-coding-agent 1.5.2 `dist/core/agent-session.js:1544-1552, 1726`): its first request may go out.
	test("in a before_agent_start handler: the run the prompt then starts ends aborted, and none of its tools run", async () => {
		t = await HostRig.create();
		const gate = t.gate("beforeStartGate");
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		const prompting = live.prompt("go");
		await gate.entered.promise;

		const aborting = live.control.abort();
		gate.open();

		expect(await prompting).toMatchObject({ status: "accepted", disposition: "started" });
		const finished = await live.waitFor("run_finished");
		expect(finished.outcome.kind).toBe("aborted");
		expect((await aborting).status).toBe("accepted");
		expect(t.router.requests(live.ref.sessionId).length).toBeLessThanOrEqual(1);
		expect(live.events().some((event) => event.type === "tool_finished" && event.outcome === "completed")).toBe(false);
		live.assertSettled();
	});

	test("a prompt that is not a start does not inherit the abort", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("first");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		const gate = t.gate("inputGate");
		const steering = live.prompt("steer me", "steer");
		await gate.entered.promise;

		const aborting = live.control.abort();
		gate.open();
		await aborting;

		expect(await steering).toMatchObject({ status: "accepted", disposition: "steered" });
		await live.waitFor("run_finished");
		live.assertValid();
	});
});

// The run lasts until Pi has settled it, its extensions' `agent_settled` handlers included.
describe("a prompt while Pi settles a run", () => {
	test("is busy, and the one after the run finished starts its own run", async () => {
		t = await HostRig.create();
		const gate = t.gate("settleGate");
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [say("one"), say("two")]);
		expect(await live.prompt("first")).toMatchObject({ disposition: "started" });
		await gate.entered.promise;

		expect(await live.prompt("too soon")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(countOf(live, "run_finished")).toBe(0);

		gate.open();
		await live.waitFor("run_finished");
		expect(await live.prompt("second")).toMatchObject({ status: "accepted", disposition: "started" });
		await until(() => countOf(live, "run_finished") === 2, "both runs finish");
		const types = live.events().map((event) => event.type);
		expect(types.filter((type) => type === "run_started" || type === "run_finished")).toEqual([
			"run_started",
			"run_finished",
			"run_started",
			"run_finished",
		]);
		expect(userMessages(live).map((message) => message.text)).toEqual(["first", "second"]);
		live.assertSettled();
	});

	test("a shutdown that finds a prompt Pi is still deciding answers it closed, does not hang, and leaves pi to its holder", async () => {
		t = await HostRig.create();
		const gate = t.gate("inputGate");
		const live = await t.rig.rig.openNew();
		const pending = live.prompt("first");
		await gate.entered.promise;

		await t.rig.rig.backend.dispose();

		expect(await pending).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
		expect(t.rig.world.sessionProcesses()).toBe(1);
		await stopHolders(t.rig.world.holdersRoot);
		expect(t.rig.world.sessionProcesses()).toBe(0);
	});
});

describe("two prompts at once", () => {
	test("one starts the run and the other is busy; neither is lost", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });

		const [first, second] = await Promise.all([live.prompt("a"), live.prompt("b")]);

		expect(first).toMatchObject({ status: "accepted", disposition: "started" });
		expect(second).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		await live.waitFor("user_message");
		expect(userMessages(live).map((message) => message.text)).toEqual(["a"]);
		expect(countOf(live, "run_started")).toBe(1);
	});

	test("two start prompts with one clientRequestId run once", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const id = crypto.randomUUID();

		const [first, second] = await Promise.all([live.prompt("a", "start", id), live.prompt("a", "start", id)]);

		expect(second).toEqual(first);
		await live.waitFor("run_finished");
		expect(countOf(live, "run_started")).toBe(1);
		expect(userMessages(live)).toHaveLength(1);
	});
});

describe("open, close, open", () => {
	test("sequential reopens of an idle session end each runtime before the next starts", async () => {
		t = await HostRig.create();
		const first = await t.rig.rig.openNew();
		await t.rig.rig.arrange(first.ref, { kind: "reply" });
		await first.run("one");
		const { sessionId } = first.ref;
		await first.close();

		for (let round = 2; round <= 4; round++) {
			await until(() => t?.router.liveRuntimes(sessionId) === 0, "the idle runtime ends");
			const again = await t.rig.rig.open(first.ref);
			expect(t.router.starts(sessionId)).toBe(round);
			expect(t.router.liveRuntimes(sessionId)).toBe(1);
			await again.close();
		}
		await until(() => t?.router.liveRuntimes() === 0, "the last runtime ends");
	});

	test("a close and an open at the same moment never leave two runtimes", async () => {
		t = await HostRig.create();
		const first = await t.rig.rig.openNew();
		await t.rig.rig.arrange(first.ref, { kind: "reply" });
		await first.run("one");
		const { sessionId } = first.ref;

		const [, second] = await Promise.all([first.close(), t.rig.rig.open(first.ref)]);

		expect(t.router.liveRuntimes(sessionId)).toBe(1);
		await second.close();
		await until(() => t?.router.liveRuntimes() === 0, "the last runtime ends");
	});

	test("two opens of a session nobody hosts share one runtime", async () => {
		t = await HostRig.create();
		const first = await t.rig.rig.openNew();
		await t.rig.rig.arrange(first.ref, { kind: "reply" });
		await first.run("one");
		const { sessionId } = first.ref;
		await first.close();
		await until(() => t?.router.liveRuntimes(sessionId) === 0, "the idle runtime ends");
		const starts = t.router.starts(sessionId);

		await Promise.all([t.rig.rig.open(first.ref), t.rig.rig.open(first.ref)]);

		expect(t.router.starts(sessionId)).toBe(starts + 1);
		expect(t.router.liveRuntimes(sessionId)).toBe(1);
	});

	test("a close during a run keeps the runtime until the run has ended", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		await live.close();
		await pause(30);
		expect(t.router.liveRuntimes(live.ref.sessionId)).toBe(1);

		await t.rig.driver.release(live.ref);
		await until(() => t?.router.liveRuntimes() === 0, "the runtime ends once the run has");
	});
});

describe("an abort reaches an ask that has no signal", () => {
	test("withdraws the ask first, so the run ends at once rather than at the abort deadline", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [askHuman("select", "Pick", { options: ["a", "b"] }), say("never")]);
		await live.prompt("ask me");
		await live.waitFor("interaction_requested");

		const started = Date.now();
		expect((await live.control.abort()).status).toBe("accepted");
		const finished = await live.waitFor("run_finished");

		expect(Date.now() - started).toBeLessThan(2_000);
		expect(finished.outcome.kind).toBe("aborted");
		const events = eventTypesOf(live.events());
		expect(events.indexOf("interaction_resolved")).toBeLessThan(events.indexOf("run_finished"));
		live.assertSettled();
	});
});

describe("a tool that ignores the abort", () => {
	test("keeps the run open past an abort that was answered, and the run then ends aborted", async () => {
		t = await HostRig.create();
		const gate = t.gate("toolGate");
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [call("ignore_abort", {}), say("after")]);
		await live.prompt("go");
		await gate.entered.promise;

		const aborting = live.control.abort();
		await pause(300);
		expect(countOf(live, "run_finished")).toBe(0);

		gate.open();
		expect(await aborting).toEqual({ status: "accepted" });
		const finished = await live.waitFor("run_finished");
		expect(finished.outcome.kind).toBe("aborted");
		live.assertSettled();
	});
});

function eventTypesOf(events: readonly { type: string }[]): string[] {
	return events.map((event) => event.type);
}

describe("the queue", () => {
	test("holds at most the contract's bound: the next steer or queue prompt is busy, and nothing is lost", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		for (let n = 0; n < MAX_LIST_ITEMS; n++) {
			const queued = await live.prompt(`later ${n}`, n % 2 === 0 ? "queue" : "steer");
			if (queued.status !== "accepted") throw new Error(`prompt ${n} was refused: ${JSON.stringify(queued)}`);
		}
		const refused = await live.prompt("one too many", "queue");

		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(live.reduced().queue).toHaveLength(MAX_LIST_ITEMS);
		live.assertValid();
	}, 30_000);
});
