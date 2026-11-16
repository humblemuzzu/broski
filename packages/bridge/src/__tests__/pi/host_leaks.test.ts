/**
 * Hosting leaks nothing: after many open / prompt / close cycles no `pi`, lock, host or timer of the cycles is left,
 * the hosts are collected, and the heap does not climb with the cycle count.
 */

import { afterEach, expect, test } from "bun:test";
import { stopHolders } from "../../backends/pi/holder/holders";
import { MAX_HOSTED_SESSIONS } from "../../backends/pi/live/host-capacity";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, trackLongTimers, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const CYCLES = 30;

function sizeOf(value: unknown): number {
	return value instanceof Map ? value.size : -1;
}

/** A cycle's host is held only weakly, so the test itself keeps nothing alive. */
async function cycle(rig: HostRig): Promise<WeakRef<object>> {
	const live = await rig.rig.rig.openNew();
	await rig.rig.rig.arrange(live.ref, { kind: "reply" });
	const host = rig.host(live.ref);
	await live.run("hello");
	await live.close();
	return new WeakRef(host);
}

async function collected(): Promise<void> {
	for (let round = 0; round < 10; round++) {
		await pause(20);
		Bun.gc(true);
	}
}

function heapMb(): number {
	return process.memoryUsage().heapUsed / 1_048_576;
}

test("open/prompt/close cycles leave no pi, lock, host or timer, and the hosts are collected", async () => {
	t = await HostRig.create();
	for (let i = 0; i < 5; i++) await cycle(t);
	await until(() => t?.rig.world.sessionProcesses() === 0, "the warm-up pi processes end");
	await collected();
	const heapBefore = heapMb();

	const hosts: WeakRef<object>[] = [];
	for (let i = 0; i < CYCLES; i++) hosts.push(await cycle(t));
	await until(() => t?.rig.world.sessionProcesses() === 0, "every pi ends", 10_000);
	await t.rig.driver.quiesce();

	expect(sizeOf(Reflect.get(t.hosts, "hosts"))).toBe(0);
	expect(sizeOf(Reflect.get(Reflect.get(t.hosts, "locks"), "tails"))).toBe(0);
	await collected();
	const alive = hosts.filter((host) => host.deref() !== undefined).length;
	const heapAfter = heapMb();
	console.log(`hosts alive ${alive}/${CYCLES}; heap ${heapBefore.toFixed(1)} -> ${heapAfter.toFixed(1)} MB`);
	expect(alive).toBeLessThanOrEqual(2);
	expect(heapAfter - heapBefore).toBeLessThan(10);
}, 120_000);

test("cycles that abort a held run, and cycles that shut down mid-run, leave no timer or host behind, and no pi once the holders stop", async () => {
	t = await HostRig.create();
	const timers = trackLongTimers();
	const hosts: WeakRef<object>[] = [];
	for (let i = 0; i < 10; i++) {
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		hosts.push(new WeakRef(t.host(live.ref)));
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		await live.control.abort();
		await live.waitFor("run_finished");
		await live.close();
	}
	await until(() => t?.rig.world.sessionProcesses() === 0, "every pi ends", 10_000);
	for (let i = 0; i < MAX_HOSTED_SESSIONS - 1; i++) {
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		hosts.push(new WeakRef(t.host(live.ref)));
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
	}
	await t.rig.rig.backend.dispose();

	expect(t.rig.world.sessionProcesses()).toBe(MAX_HOSTED_SESSIONS - 1);
	await stopHolders(t.rig.world.holdersRoot);
	expect(t.rig.world.sessionProcesses()).toBe(0);
	expect(sizeOf(Reflect.get(t.hosts, "hosts"))).toBe(0);
	await collected();
	expect(hosts.filter((host) => host.deref() !== undefined).length).toBeLessThanOrEqual(2);
	timers.stop();
	expect(timers.setBy()).toEqual([]);
}, 120_000);
