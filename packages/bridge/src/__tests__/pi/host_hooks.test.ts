/**
 * A hook that throws at each stage of a session's life, and a tool that ignores Stop. Whatever Pi's extension
 * runner does with the throw, the adapter must still end the run it started, take the next prompt, and shut down
 * inside its deadlines.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { ABORT_DEADLINE_MS } from "../../backends/pi/live/pi-child";
import { SETTLE_DEADLINE_MS } from "../../backends/pi/live/session-host";
import { STOP_BUDGET_MS } from "../../backends/pi/rpc/child";
import type { AgentEvent } from "../../contract";
import { DEFAULT_TEARDOWN_TIMEOUT_MS } from "../../lifecycle/teardown";
import { countOf } from "./helpers/live-steps";
import { call, say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause, until } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

/** Pi told the phone about the throw: a notice from the extension runner, or the failed tool's own error. */
function reported(events: readonly AgentEvent[], stage: string): boolean {
	return events.some((event) => {
		if (event.type === "notice") return event.text.includes(`boom in ${stage}`);
		return event.type === "tool_finished" && event.result.error === `boom in ${stage}`;
	});
}

const RUN_STAGES: string[] = ["input", "before_agent_start", "message_end", "agent_settled", "tool"];

describe("a hook that throws while a run goes", () => {
	test.each(
		RUN_STAGES,
	)("in %s: the run ends once, the session takes the next prompt, and it shuts down", async (stage) => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [call("ignore_abort", {}), say("done")]);
		t.set({ throwAt: stage });

		const first = await live.prompt("go");
		if (first.status === "accepted") {
			await live.waitFor("run_finished");
			expect(countOf(live, "run_started")).toBe(countOf(live, "run_finished"));
		}
		await t.rig.driver.quiesce();
		expect(reported(live.events(), stage)).toBe(true);
		expect(live.reduced().run).toBeUndefined();
		live.assertSettled();

		t.set({ throwAt: undefined });
		t.router.script(live.ref.sessionId, [say("fine")]);
		expect((await live.run("again")).outcome.kind).toBe("completed");

		await t.rig.rig.backend.dispose();
		expect(t.rig.world.sessionProcesses()).toBe(0);
	});
});

describe("a hook that throws outside a run", () => {
	test("in session_start: the session still opens", async () => {
		t = await HostRig.create();
		t.set({ throwAt: "session_start" });
		const live = await t.rig.rig.openNew();
		t.set({ throwAt: undefined });
		t.router.script(live.ref.sessionId, [say("fine")]);
		expect((await live.run("hello")).outcome.kind).toBe("completed");
	});

	test("in session_shutdown: the idle host still ends and its pi exits", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		expect(t.rig.world.sessionProcesses()).toBe(1);
		t.set({ throwAt: "session_shutdown" });
		await live.close();
		await until(() => t?.rig.world.sessionProcesses() === 0, "the host ends");
	});

	test("in session_before_compact: the compaction fails, nothing stays locked", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("one");
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.run("two");

		t.set({ throwAt: "session_before_compact" });
		await live.control.compact?.(undefined);
		await t.rig.driver.quiesce();
		t.set({ throwAt: undefined });

		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect((await live.run("after")).outcome.kind).toBe("completed");
		live.assertSettled();
	});
});

describe("a tool that ignores Stop", () => {
	test("Stop is answered at its deadline with the run still open, and shutdown ends inside the bridge's teardown", async () => {
		t = await HostRig.create();
		const gate = t.gate("toolGate");
		const live = await t.rig.rig.openNew();
		t.router.script(live.ref.sessionId, [call("ignore_abort", {}), say("never")]);
		await live.prompt("go");
		await gate.entered.promise;

		const stopStarted = Date.now();
		expect((await live.control.abort()).status).toBe("accepted");
		const stopTook = Date.now() - stopStarted;
		expect(stopTook).toBeGreaterThanOrEqual(ABORT_DEADLINE_MS - 200);
		expect(stopTook).toBeLessThan(ABORT_DEADLINE_MS + 2_000);
		expect(countOf(live, "run_finished")).toBe(0);

		const downStarted = Date.now();
		await t.rig.rig.backend.dispose();
		const downTook = Date.now() - downStarted;
		expect(downTook).toBeGreaterThanOrEqual(SETTLE_DEADLINE_MS - 200);
		expect(downTook).toBeLessThan(SETTLE_DEADLINE_MS + STOP_BUDGET_MS + 300);
		expect(downTook).toBeLessThan(DEFAULT_TEARDOWN_TIMEOUT_MS);
		expect(t.rig.world.sessionProcesses()).toBe(0);
		const after = live.recorder.items.length;
		await pause(100);
		expect(live.recorder.items.length).toBe(after);
	}, 40_000);
});
