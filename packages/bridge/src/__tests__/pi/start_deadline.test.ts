/**
 * An extension that never finishes loading, or never returns from `session_start`, and asks nobody: the open fails
 * within the start deadline instead of holding the request, the session lock and a half-built host for good, and the
 * `pi` it started is stopped.
 */

import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { START_DEADLINE_MS } from "../../backends/pi/live/pi-child";
import { STOP_BUDGET_MS } from "../../backends/pi/rpc/child";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

async function failsInTime(rig: HostRig): Promise<void> {
	const began = performance.now();
	const opened = await rig.rig.rig.backend.open({ kind: "new", options: { cwd: rig.rig.cwd } }, { emit: () => {} });
	const took = performance.now() - began;
	expect(opened).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
	expect(took).toBeGreaterThanOrEqual(START_DEADLINE_MS - 200);
	expect(took).toBeLessThan(START_DEADLINE_MS + STOP_BUDGET_MS + 1_000);
	expect(Reflect.get(rig.hosts, "hosts").size).toBe(0);
	expect(Reflect.get(Reflect.get(rig.hosts, "locks"), "tails").size).toBe(0);
	expect(rig.rig.world.sessionProcesses()).toBe(0);
	expect(readdirSync(rig.rig.world.sessionsRoot, { recursive: true })).toEqual([]);
}

test(
	"an extension whose load never ends",
	async () => {
		t = await HostRig.create();
		t.gate("loadGate");
		await failsInTime(t);
	},
	START_DEADLINE_MS + 15_000,
);

test(
	"an extension whose session_start never returns",
	async () => {
		t = await HostRig.create();
		const gate = t.gate("startGate");
		await failsInTime(t);
		await gate.entered.promise;
	},
	START_DEADLINE_MS + 15_000,
);
