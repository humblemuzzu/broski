/**
 * The bound on hosted `pi` processes (`live/host-capacity.ts`): an idle host, even one a phone has open, ends to make
 * room for another and starts again with the phone's next action; a host with work in flight is never ended, and when
 * all are busy an open is refused as `busy`. The real `pi` runs, with the limit set to two.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { LiveRig } from "./helpers/live-rig";
import { useWatchdog } from "./helpers/use-watchdog";

useWatchdog();

let t: LiveRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const hosted = (rig: LiveRig, live: LiveSession) => rig.world.parts.hosts.host(live.ref.sessionId) !== undefined;

/** Starts a run that stays inside a tool until the session is stopped. */
async function working(rig: LiveRig, live: LiveSession): Promise<void> {
	await rig.rig.arrange(live.ref, { kind: "hold" });
	await live.prompt("work");
	await live.waitFor("tool_started", (event) => event.name === "driver_hold");
}

async function stopped(live: LiveSession): Promise<void> {
	await live.control.abort();
	await live.waitFor("run_finished");
}

describe("with room for two hosted sessions", () => {
	test("the least recently used idle host ends for a third, and its open view starts a new one when the phone acts", async () => {
		t = await LiveRig.create({ maxHosted: 2 });
		const first = await t.rig.openNew();
		const second = await t.rig.openNew();
		const third = await t.rig.openNew();

		expect(t.world.sessionProcesses()).toBe(2);
		expect([first, second, third].map((live) => hosted(t as LiveRig, live))).toEqual([false, true, true]);
		expect(first.events().filter((event) => event.type === "resynced")).toEqual([]);

		await t.rig.arrange(first.ref, { kind: "reply" });
		expect((await first.run("back again")).outcome).toEqual({ kind: "completed" });

		expect(first.events().filter((event) => event.type === "resynced")).toHaveLength(1);
		expect([first, second, third].map((live) => hosted(t as LiveRig, live))).toEqual([true, false, true]);
		expect(t.world.sessionProcesses()).toBe(2);
		first.assertSettled();
	});

	test("a host with work in flight is never ended: a third open is refused as busy, and leaves nothing behind", async () => {
		t = await LiveRig.create({ maxHosted: 2 });
		const first = await t.rig.openNew();
		const second = await t.rig.openNew();
		await working(t, first);
		await working(t, second);

		const refused = await t.backend.open({ kind: "new", options: { cwd: t.cwd } }, { emit: () => {} });

		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(refused.status === "rejected" && refused.rejection.message).toContain("2 Pi sessions");
		expect(t.world.sessionProcesses()).toBe(2);
		expect(
			readdirSync(t.world.sessionsRoot, { recursive: true }).filter((name) => `${name}`.endsWith(".jsonl")),
		).toHaveLength(2);
		expect(first.reduced().run).toBeDefined();
		expect(second.reduced().run).toBeDefined();

		await stopped(first);
		const third = await t.rig.openNew();
		expect(hosted(t, first)).toBe(false);
		expect(hosted(t, second) && hosted(t, third)).toBe(true);
	});

	test("an evicted session's view is refused as busy while every other host is busy, and revives once one is idle", async () => {
		t = await LiveRig.create({ maxHosted: 2 });
		const evicted = await t.rig.openNew();
		const second = await t.rig.openNew();
		const third = await t.rig.openNew();
		await working(t, second);
		await working(t, third);
		expect(hosted(t, evicted)).toBe(false);

		await t.rig.arrange(evicted.ref, { kind: "reply" });
		expect(await evicted.prompt("too soon")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		expect(t.world.sessionProcesses()).toBe(2);

		await stopped(second);
		expect((await evicted.run("now")).outcome).toEqual({ kind: "completed" });
		expect(hosted(t, evicted)).toBe(true);
	});
});
