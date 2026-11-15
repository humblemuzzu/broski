/** What becomes of input queued as a run ends: a prompt sent while Pi settles runs next; Stop hands queued input back. */

import { afterEach, expect, test } from "bun:test";
import { countOf, userMessages } from "./helpers/live-steps";
import { say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

// Pi answers a prompt sent while it settles a run once it has settled, and runs it then (pi-coding-agent 1.5.2).
test("a prompt queued while Pi settles the run waits for the settle and runs on its own; nothing is left queued", async () => {
	t = await HostRig.create();
	const live = await t.rig.rig.openNew();
	t.router.script(live.ref.sessionId, [say("one"), say("two")]);
	const gate = t.gate("settleGate");
	await live.prompt("go");
	await gate.entered.promise;
	const queued = live.prompt("too late for this run", "queue");
	await pause(100);
	expect(countOf(live, "run_finished")).toBe(0);
	gate.open();

	expect(await queued).toEqual({ status: "accepted", disposition: "started" });
	await until(() => countOf(live, "run_finished") === 2, "both runs finish");
	expect(userMessages(live).map((message) => message.text)).toEqual(["go", "too late for this run"]);
	expect(live.events().some((event) => event.type === "notice" && event.text.includes("not sent"))).toBe(false);
	expect(live.reduced().queue).toHaveLength(0);
	live.assertSettled();
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
