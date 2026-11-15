/**
 * Nothing an extension asks a human, and no compaction Pi runs first, holds a request to the core's deadlines
 * (30 s for an open, 120 s for a prompt): a `session_start` ask fails the open at once, and a prompt Pi is still
 * deciding when a human is asked about it, or a compaction begins, is answered `started` then.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SETTLE_DEADLINE_MS } from "../../backends/pi/live/session-host";
import { STOP_BUDGET_MS } from "../../backends/pi/rpc/child";
import type { InteractionAnswer } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { countOf } from "./helpers/live-steps";
import { MODELS, wireIdOf } from "./helpers/pi-world";
import { say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig } from "./host_rig";

useWatchdog();

let t: HostRig | undefined;

afterEach(async () => {
	await t?.dispose();
	t = undefined;
});

const confirm = (interactionId: string, confirmed: boolean): InteractionAnswer => ({
	interactionId,
	reply: { kind: "confirm", confirmed },
});

const typesOf = (live: LiveSession) => live.events().map((event) => event.type);
const count = (live: LiveSession, type: string) => typesOf(live).filter((seen) => seen === type).length;

// Pi reads no answer before its extensions have started (pi-coding-agent 1.5.2 `dist/modes/rpc/rpc-mode.js:305,669`).
describe("an extension that asks in session_start", () => {
	test("makes the open fail at once, naming the ask, and leaves no pi behind", async () => {
		t = await HostRig.create();
		t.set({ askOnStart: true });
		const began = performance.now();
		const opened = await t.rig.rig.backend.open({ kind: "new", options: { cwd: t.rig.cwd } }, { emit: () => {} });
		expect(opened).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
		expect(opened.status === "rejected" && opened.rejection.message).toContain('"Start?"');
		expect(performance.now() - began).toBeLessThan(SETTLE_DEADLINE_MS + STOP_BUDGET_MS);
		expect(t.rig.world.sessionProcesses()).toBe(0);
		expect(t.answers).toEqual([]);
	});
});

describe("a prompt Pi is still deciding when a human is asked about it", () => {
	test("in an input handler: answered started, the ask blocks the run it names, and the run goes on once answered", async () => {
		t = await HostRig.create();
		t.set({ askOn: "input" });
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		const clientRequestId = crypto.randomUUID();

		expect(await live.prompt("send this", "start", clientRequestId)).toEqual({
			status: "accepted",
			disposition: "started",
		});
		const { interaction } = await live.waitFor("interaction_requested");
		const started = await live.waitFor("run_started");
		expect(interaction).toMatchObject({ title: "Send it?", runId: started.runId, blocksRun: true });
		expect(started.trigger).toBe("prompt");
		expect(await live.prompt("another")).toMatchObject({ status: "rejected", rejection: { code: "busy" } });

		await live.control.answer(confirm(interaction.id, true));
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(live.events()).toContainEqual(expect.objectContaining({ type: "user_message", clientRequestId }));
		expect(countOf(live, "run_started")).toBe(1);
		expect(t.answers).toEqual([true]);
		live.assertSettled();
	});

	test("in an input handler that then handles the prompt itself: the run ends completed with nothing in it", async () => {
		t = await HostRig.create();
		t.set({ askOn: "input" });
		const live = await t.rig.rig.openNew();

		expect(await live.prompt("never mind")).toMatchObject({ disposition: "started" });
		const { interaction } = await live.waitFor("interaction_requested");
		await live.control.answer(confirm(interaction.id, false));

		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(count(live, "user_message")).toBe(0);
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(0);
		live.assertSettled();
	});

	test("Stop while the ask waits withdraws it, and the run ends aborted without reaching the model", async () => {
		t = await HostRig.create();
		t.set({ askOn: "input" });
		const live = await t.rig.rig.openNew();
		await live.prompt("stop me");
		const { interaction } = await live.waitFor("interaction_requested");

		expect(await live.control.abort()).toEqual({ status: "accepted" });
		expect(await live.waitFor("interaction_resolved", (event) => event.interactionId === interaction.id)).toMatchObject(
			{ reason: "withdrawn" },
		);
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "aborted" });
		expect(t.router.requests(live.ref.sessionId)).toHaveLength(0);
		live.assertSettled();
	});

	test("in a before_agent_start handler: one run, started when asked, which goes on once answered", async () => {
		t = await HostRig.create();
		t.set({ askOn: "before_agent_start" });
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });

		expect(await live.prompt("go")).toMatchObject({ disposition: "started" });
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction.blocksRun).toBe(true);
		await live.control.answer(confirm(interaction.id, true));

		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(countOf(live, "run_started")).toBe(1);
		expect(t.answers).toEqual([true]);
		live.assertSettled();
	});
});

describe("a compaction Pi runs before the prompt", () => {
	test("starts the prompt's run, so the compaction is inside it and the prompt is not held for it", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew({ modelId: wireIdOf(MODELS.plain) });
		t.router.script(live.ref.sessionId, [say("x".repeat(16_000))]);
		await live.run("fill a large window");
		expect(count(live, "compaction_started")).toBe(0);
		expect(await live.control.setModel(wireIdOf(MODELS.tiny))).toEqual({ status: "accepted" });

		const mark = live.recorder.items.length;
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect(await live.prompt("now in a tiny window")).toMatchObject({ disposition: "started" });
		expect((await live.waitFor("run_finished", () => true, mark)).outcome).toEqual({ kind: "completed" });
		const order = typesOf(live)
			.slice(mark)
			.filter((type) => ["run_started", "compaction_started", "compaction_finished", "run_finished"].includes(type));
		expect(order.slice(0, 3)).toEqual(["run_started", "compaction_started", "compaction_finished"]);
		expect(order.at(-1)).toBe("run_finished");
		expect(order.filter((type) => type === "run_started")).toHaveLength(1);
		live.assertSettled();
	});
});

describe("an extension whose handler asks before it awaits anything, inside Pi's own call", () => {
	test("as an input handler: the prompt is answered started, the ask names the run and blocks it", async () => {
		t = await HostRig.create();
		t.set({ askOn: "input-at-once" });
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });

		expect(await live.prompt("send this")).toEqual({ status: "accepted", disposition: "started" });
		const { interaction } = await live.waitFor("interaction_requested");
		const started = await live.waitFor("run_started");
		expect(interaction).toMatchObject({ title: "Send it?", runId: started.runId, blocksRun: true });

		await live.control.answer(confirm(interaction.id, true));
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(t.answers).toEqual([true]);
		live.assertSettled();
	});
});
