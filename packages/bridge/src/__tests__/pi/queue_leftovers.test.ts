/**
 * A follow-up Pi takes after its run's last look at its queue (pi-coding-agent `src/core/agent-session.ts:1906-1908`
 * against `:1080`) stays queued when the run settles, in the terminal too: the phone is told it goes with the next prompt.
 */

import { afterEach, expect, test } from "bun:test";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

test("a run that settles with input still in Pi's queue says it was not sent", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	await t.rig.rig.arrange(live.ref, { kind: "reply" });
	const gate = t.gate("settleGate");
	await live.prompt("go");
	await gate.entered.promise;
	await t.session(live.ref).followUp("too late for this run");
	gate.open();

	await live.waitFor("run_finished");
	const notice = await live.waitFor("notice", (event) => event.text.includes("not sent"));
	expect(notice.level).toBe("warning");
});

test("a run stopped with input still queued says nothing is left: Stop handed it back", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	await t.rig.rig.arrange(live.ref, { kind: "hold" });
	await live.prompt("go");
	await live.waitFor("tool_started", (event) => event.name === "driver_hold");
	expect(await live.prompt("then this", "queue")).toMatchObject({ disposition: "queued" });
	await live.control.abort();
	await live.waitFor("run_finished");
	expect(live.events().some((event) => event.type === "notice" && event.text.includes("not sent"))).toBe(false);
	expect(live.events().filter((event) => event.type === "input_returned")).toEqual([
		{ type: "input_returned", texts: ["then this"] },
	]);
	expect(live.reduced().queue).toHaveLength(0);
});

test("why one queued item cannot be taken back: Pi clears its queue whole, and queued again an input meets the extensions anew", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	await t.rig.rig.arrange(live.ref, { kind: "hold" });
	await live.prompt("go");
	await live.waitFor("tool_started", (event) => event.name === "driver_hold");
	expect(await live.prompt("keep me", "steer")).toMatchObject({ disposition: "steered" });
	expect(await live.prompt("drop me", "steer")).toMatchObject({ disposition: "steered" });
	const session = t.session(live.ref);

	expect(session.clearQueue()).toEqual({ steering: ["keep me", "drop me"], followUp: [] });
	await session.steer("keep me");

	expect(t.state.inputs).toEqual(["go", "keep me", "drop me", "keep me"]);
	await live.control.abort();
	await live.waitFor("run_finished");
});
