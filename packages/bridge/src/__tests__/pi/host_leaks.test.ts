/**
 * Hosting leaks nothing: after many open / prompt / close cycles no runtime, listener, lock, host or timer
 * of the cycles is left, and the heap does not climb with the cycle count.
 */

import { afterEach, expect, test } from "bun:test";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, trackLongTimers, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

function sizeOf(value: unknown): number {
	return value instanceof Map ? value.size : -1;
}

/** A cycle's Pi session is held only weakly, so the test itself keeps nothing alive. */
async function cycle(rig: HostRig): Promise<WeakRef<object>> {
	const live = await rig.rig.rig.openNew();
	await rig.rig.rig.arrange(live.ref, { kind: "reply" });
	const session = rig.session(live.ref);
	await live.run("hello");
	await live.close();
	return new WeakRef(session);
}

function listenersOf(session: object | undefined): number {
	const held = session && Reflect.get(session, "_eventListeners");
	return Array.isArray(held) ? held.length : session ? -1 : 0;
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

test("100 open/prompt/close cycles leave no runtime, listener, lock, host or timer, and the sessions are collected", async () => {
	t = await HostRig.create();
	for (let i = 0; i < 20; i++) await cycle(t);
	await until(() => t?.bus.liveRuntimes() === 0, "the warm-up runtimes end");
	await collected();
	const heapBefore = heapMb();

	const sessions: WeakRef<object>[] = [];
	for (let i = 0; i < 100; i++) sessions.push(await cycle(t));
	await until(() => t?.bus.liveRuntimes() === 0, "every runtime ends", 10_000);
	await t.rig.driver.quiesce();

	expect(t.bus.liveRuntimes()).toBe(0);
	expect(sizeOf(Reflect.get(t.hosts, "hosts"))).toBe(0);
	expect(sizeOf(Reflect.get(Reflect.get(t.hosts, "locks"), "tails"))).toBe(0);
	expect(sessions.map((session) => listenersOf(session.deref())).filter((count) => count !== 0)).toEqual([]);
	await collected();
	const alive = sessions.filter((session) => session.deref() !== undefined).length;
	const heapAfter = heapMb();
	console.log(`sessions alive ${alive}/100; heap ${heapBefore.toFixed(1)} -> ${heapAfter.toFixed(1)} MB`);
	expect(alive).toBeLessThanOrEqual(2);
	expect(heapAfter - heapBefore).toBeLessThan(10);
}, 60_000);

test("30 cycles that abort a held run, and 30 that shut down mid-run, leave no timer or session behind", async () => {
	t = await HostRig.create();
	const timers = trackLongTimers();
	const sessions: WeakRef<object>[] = [];
	for (let i = 0; i < 30; i++) {
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		sessions.push(new WeakRef(t.session(live.ref)));
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
		await live.control.abort();
		await live.waitFor("run_finished");
		await live.close();
	}
	await until(() => t?.bus.liveRuntimes() === 0, "every runtime ends", 10_000);
	for (let i = 0; i < 30; i++) {
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "hold" });
		sessions.push(new WeakRef(t.session(live.ref)));
		await live.prompt("go");
		await live.waitFor("tool_started", (event) => event.name === "driver_hold");
	}
	await t.rig.rig.backend.dispose();

	expect(t.bus.liveRuntimes()).toBe(0);
	expect(sizeOf(Reflect.get(t.hosts, "hosts"))).toBe(0);
	expect(sessions.map((session) => listenersOf(session.deref())).filter((count) => count !== 0)).toEqual([]);
	await collected();
	expect(sessions.filter((session) => session.deref() !== undefined).length).toBeLessThanOrEqual(2);
	timers.stop();
	expect(timers.outstanding()).toBe(0);
}, 60_000);
