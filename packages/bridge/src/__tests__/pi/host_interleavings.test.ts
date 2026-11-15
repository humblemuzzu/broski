/**
 * Interleavings tried against the adapter on purpose: Stop around a settle, Stop twice, a prompt while a
 * compaction is taken, and a shutdown that arrives while a session is still being opened.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { countOf } from "./helpers/live-steps";
import { say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, until } from "./host_rig";

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

	// The run lasts until Pi has settled it, extensions' `agent_settled` handlers included, so a prompt is `busy` till then.
	test("while Pi settles the run it is answered, a prompt meanwhile is busy, and the next one runs", async () => {
		t = await HostRig.create();
		const gate = t.gate("settleGate");
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [say("one"), say("two")]);
		await live.prompt("first");
		await gate.entered.promise;
		expect(await live.prompt("second")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });

		expect((await live.control.abort()).status).toBe("accepted");
		gate.open();
		await live.waitFor("run_finished");

		const mark = live.recorder.items.length;
		expect(await live.prompt("third")).toMatchObject({ status: "accepted", disposition: "started" });
		await live.waitFor("run_finished", () => true, mark);
		expect(countOf(live, "run_finished")).toBe(2);
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
		expect(t.router.liveRuntimes(live.ref.sessionId)).toBe(1);
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
		await live.waitFor("run_finished", () => true, mark);
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("now")).outcome.kind).toBe("completed");
	});
});

describe("a shutdown while a session is being opened", () => {
	test("the open that was parked in an extension answers closed, and no pi is left", async () => {
		t = await HostRig.create();
		const gate = t.gate("loadGate");
		const opening = t.rig.rig.backend.open({ kind: "new", options: { cwd: t.rig.cwd } }, { emit: () => {} });
		await gate.entered.promise;
		expect(t.rig.world.sessionProcesses()).toBe(1);

		const disposing = t.rig.rig.backend.dispose();
		gate.open();
		expect(await opening).toMatchObject({ status: "rejected", rejection: { code: "closed" } });
		await disposing;
		expect(t.rig.world.sessionProcesses()).toBe(0);
	});
});
