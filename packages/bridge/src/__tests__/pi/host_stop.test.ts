/**
 * Stop on work that is not a run: a compaction by hand. Pi's own `abort()` cancels it
 * (pi `src/core/agent-session.ts:2498-2508`); the contract's abort is
 * "accepted and without effect" only when nothing at all is under way (conformance rule 19: an idle session
 * emits nothing). The extension parks the handler that runs inside the work until its signal aborts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function sessionWithHistory(rig: HostRig) {
	const live = await rig.rig.rig.openNew();
	await rig.rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("one");
	await rig.rig.rig.arrange(live.ref, { kind: "reply" });
	await live.run("two");
	return live;
}

describe("Stop on an idle session", () => {
	test("an idle session's Stop is still accepted and silent", async () => {
		t = await HostRig.create();
		const live = await sessionWithHistory(t);
		const mark = live.recorder.items.length;

		expect((await live.control.abort()).status).toBe("accepted");

		await t.rig.driver.quiesce();
		expect(live.recorder.items.length).toBe(mark);
	});
});

describe("Stop while a compaction by hand is under way", () => {
	test("cancels it: compaction_finished aborted, and the session takes the next prompt", async () => {
		t = await HostRig.create();
		const live = await sessionWithHistory(t);
		const gate = t.gate("compactGate");
		const mark = live.recorder.items.length;
		expect((await live.control.compact?.(undefined))?.status).toBe("accepted");
		await gate.entered.promise;
		await live.waitFor("compaction_started", () => true, mark);

		expect((await live.control.abort()).status).toBe("accepted");

		const finished = await live.waitFor("compaction_finished", () => true, mark);
		expect(finished.outcome).toEqual({ kind: "aborted" });
		await live.waitFor("run_finished", () => true, mark);
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("after the stop")).outcome.kind).toBe("completed");
		live.assertSettled();
	});
});
