/**
 * Interleavings tried against the adapter on purpose: Stop around a settle, Stop twice, a prompt while a
 * compaction is taken, and a shutdown that arrives while a session is still being opened.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SinkRecord } from "../../contract";
import { countOf } from "./helpers/live-steps";
import { say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

describe("Stop", () => {
	test("twice at once ends the run once", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		const [first, second] = await Promise.all([live.control.abort(), live.control.abort()]);

		expect([first.status, second.status]).toEqual(["accepted", "accepted"]);
		const finished = await live.waitFor("run_finished");
		expect(finished.outcome.kind).toBe("aborted");
		await t.rig.driver.quiesce();
		expect(countOf(live, "run_finished")).toBe(1);
		live.assertSettled();
	});

	test("while Pi settles the run it is answered, and the prompt that waited behind the settle still runs", async () => {
		t = await HostRig.create();
		const gate = t.gate("settleGate");
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [say("one"), say("two")]);
		await live.prompt("first");
		await gate.entered.promise;
		const second = live.prompt("second");
		await pause(30);

		expect((await live.control.abort()).status).toBe("accepted");
		gate.open();

		expect(await second).toMatchObject({ status: "accepted", disposition: "started" });
		await until(() => countOf(live, "run_finished") === 2, "both runs finish");
		live.assertSettled();
	});

	test("then a close and a reopen in the same breath: the aborted run is finished once, in one runtime", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");

		const stopping = live.control.abort();
		await live.close();
		const again = await t.rig.rig.open(live.ref);
		await stopping;

		await until(() => again.reduced().run === undefined, "the aborted run ends");
		expect(t.bus.liveRuntimes(live.ref.sessionId)).toBe(1);
		expect(again.initial.run === undefined || again.reduced().lastOutcome?.kind === "aborted").toBe(true);
	});
});

describe("a compaction by hand", () => {
	test("refuses prompts of every mode while it is under way, and takes them once it is stopped", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("one");
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("two");
		const gate = t.gate("compactGate");
		const mark = live.recorder.items.length;
		await live.control.compact?.(undefined);
		await gate.entered.promise;
		await live.waitFor("compaction_started", () => true, mark);

		for (const mode of ["start", "steer", "queue"] as const) {
			expect(await live.prompt("not now", mode)).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		}
		expect(await live.control.compact?.(undefined)).toMatchObject({ status: "rejected", rejection: { code: "busy" } });

		await live.control.abort();
		await live.waitFor("compaction_finished", () => true, mark);
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("now")).outcome.kind).toBe("completed");
	});
});

describe("a shutdown while a session is being opened", () => {
	test("the open that was parked in an extension answers closed, and no runtime is left", async () => {
		t = await HostRig.create();
		const gate = t.gate("loadGate");
		const opening = t.rig.rig.backend.open({ kind: "new", options: { cwd: t.rig.cwd } }, { emit: () => {} });
		await gate.entered.promise;

		const disposing = t.rig.rig.backend.dispose();
		const disposed = spyOn(AgentSession.prototype, "dispose");
		gate.open();

		try {
			expect(await opening).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
			await disposing;
			expect(t.bus.liveRuntimes()).toBe(0);
			expect(disposed).toHaveBeenCalledTimes(1);
		} finally {
			disposed.mockRestore();
		}
	});

	test("a session opened on a session_start ask: shutdown expires the ask, Pi's default answers it, and no runtime is left", async () => {
		t = await HostRig.create();
		t.state.askOnStart = true;
		const records: SinkRecord[] = [];
		const opened = await t.rig.rig.backend.open(
			{ kind: "new", options: { cwd: t.rig.cwd } },
			{ emit: (record) => records.push(record) },
		);
		if (opened.status !== "accepted") throw new Error("the open was refused");
		const [ask] = opened.snapshot.interactions;
		if (!ask) throw new Error("the open's snapshot holds no ask");
		expect(ask.title).toBe("Start?");

		const started = Date.now();
		await t.rig.rig.backend.dispose();

		expect(Date.now() - started).toBeLessThan(2_000);
		expect(records.map((record) => record.event)).toContainEqual({
			type: "interaction_resolved",
			interactionId: ask.id,
			reason: "expired",
		});
		expect(t.bus.liveRuntimes()).toBe(0);
	});
});
