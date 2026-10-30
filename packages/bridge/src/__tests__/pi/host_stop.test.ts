/**
 * Stop on work that is not a run: a tree navigation that summarises the branch it leaves, and a compaction by
 * hand. Pi's own `abort()` cancels both (pi `src/core/agent-session.ts:2498-2508`); the contract's abort is
 * "accepted and without effect" only when nothing at all is under way (conformance rule 19: an idle session
 * emits nothing). The extension parks the handler that runs inside the work until its signal aborts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause } from "./host_rig";

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

describe("Stop while a navigation summarises", () => {
	test("cancels the summary, frees the session lock, and the queued prompt then runs", async () => {
		t = await HostRig.create();
		const live = await sessionWithHistory(t);
		const call = await t.rig.driver.backendCall(live.ref, "navigate_tree");
		const op = call?.op;
		if (call === undefined || op?.kind !== "navigate_tree") throw new Error("the driver made no navigate_tree call");
		const gate = t.gate("treeGate");
		const navigating = t.rig.rig.backend.call?.({ backend: "pi", op: { ...op, summarize: true } });
		await gate.entered.promise;
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const queued = live.prompt("while navigating");
		await pause(30);

		const stopped = await live.control.abort();

		expect(stopped.status).toBe("accepted");
		const outcome = await Promise.race([navigating, pause(1_500).then(() => "hung" as const)]);
		expect(outcome).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(await queued).toMatchObject({ status: "accepted", disposition: "started" });
		await live.waitFor("run_finished", (event) => event.outcome.kind === "completed", 0);
		live.assertValid();
	});

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
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("after the stop")).outcome.kind).toBe("completed");
		live.assertSettled();
	});
});
