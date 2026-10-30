/**
 * An extension that never finishes loading, or never returns from `session_start`, and asks nobody: the open fails
 * within the start deadline instead of holding the request, the session lock and a half-built host for good.
 */

import { afterEach, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { START_DEADLINE_MS } from "../../backends/pi/live/host-startup";
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
	expect(took).toBeLessThan(START_DEADLINE_MS + 2_000);
	expect(Reflect.get(rig.hosts, "hosts").size).toBe(0);
	expect(Reflect.get(Reflect.get(rig.hosts, "locks"), "tails").size).toBe(0);
	expect(readdirSync(rig.rig.world.sessionsRoot, { recursive: true })).toEqual([]);
}

test(
	"an extension whose load never ends; the runtime that arrives after the open gave up is disposed",
	async () => {
		t = await HostRig.create();
		const gate = t.gate("loadGate");
		await failsInTime(t);
		const disposed = spyOn(AgentSession.prototype, "dispose");
		try {
			gate.open();
			const deadline = Date.now() + 5_000;
			while (disposed.mock.calls.length === 0 && Date.now() < deadline) await Bun.sleep(20);
			expect(disposed).toHaveBeenCalledTimes(1);
			expect(t.bus.liveRuntimes()).toBe(0);
		} finally {
			disposed.mockRestore();
		}
	},
	START_DEADLINE_MS + 10_000,
);

test(
	"an extension whose session_start never returns",
	async () => {
		t = await HostRig.create();
		const gate = t.gate("startGate");
		await failsInTime(t);
		await gate.entered.promise;
		expect(t.bus.liveRuntimes()).toBe(0);
	},
	START_DEADLINE_MS + 10_000,
);
