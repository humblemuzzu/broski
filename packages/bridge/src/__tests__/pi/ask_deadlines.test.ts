/**
 * Nothing an extension asks a human, and no compaction Pi runs first, holds a request to the core's deadlines
 * (30 s for an open, 120 s for a prompt): a `session_start` ask opens the session with the ask in its snapshot, and
 * a prompt Pi is still deciding when a human is asked about it, or a compaction begins, is answered `started` then.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { InteractionAnswer, PromptResult } from "../../contract";
import type { LiveSession } from "../../contract/testing/conformance-harness";
import { FAUX_MODEL_IDS, wireIdOf } from "./helpers/faux-models";
import { countOf } from "./helpers/live-steps";
import { say } from "./helpers/scenarios";
import { useWatchdog } from "./helpers/use-watchdog";
import { HostRig, pause } from "./host_rig";

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

/** Prompts until the session takes it: the extensions may still be finishing their start just after the answer. */
async function promptOnceStarted(live: LiveSession, text: string): Promise<PromptResult> {
	for (let tries = 0; ; tries++) {
		const result = await live.prompt(text);
		if (result.status === "accepted" || result.rejection.code !== "busy" || tries === 100) return result;
		await pause(5);
	}
}

describe("an extension that asks in session_start", () => {
	test("opens the session with the ask pending; Pi waits for its answer, and nothing reaches Pi before", async () => {
		t = await HostRig.create();
		t.state.askOnStart = true;
		const live = await t.rig.rig.openNew();
		const [ask] = live.initial.interactions;
		if (!ask) throw new Error("the open's snapshot holds no ask");
		expect(ask).toMatchObject({ title: "Start?", blocksRun: false, request: { kind: "confirm" } });
		expect(ask).not.toHaveProperty("runId");

		for (const refused of [
			await live.prompt("too early"),
			await live.control.setModel(wireIdOf(FAUX_MODEL_IDS.plain)),
			await live.control.setThinking("low"),
			await live.control.compact?.(undefined),
		]) {
			expect(refused).toMatchObject({ status: "rejected", rejection: { code: "busy" } });
		}
		expect(await live.control.setMode("permissions", "ask")).toEqual({ status: "accepted" });
		expect(countOf(live, "run_started")).toBe(0);

		expect(await live.control.answer(confirm(ask.id, true))).toEqual({ status: "accepted" });
		await live.waitFor(
			"interaction_resolved",
			(event) => event.interactionId === ask.id && event.reason === "answered",
		);
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		await live.control.setMode("permissions", "off");
		expect(await promptOnceStarted(live, "now")).toMatchObject({ status: "accepted", disposition: "started" });
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		live.assertSettled();
	});
});

describe("a prompt Pi is still deciding when a human is asked about it", () => {
	test("in an input handler: answered started, the ask blocks the run it names, and the run goes on once answered", async () => {
		t = await HostRig.create();
		t.state.askOn = "input";
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
		expect(t.state.answers).toEqual([true]);
		live.assertSettled();
	});

	test("in an input handler that then handles the prompt itself: the run ends completed with nothing in it", async () => {
		t = await HostRig.create();
		t.state.askOn = "input";
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
		t.state.askOn = "input";
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
		t.state.askOn = "before_agent_start";
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });

		expect(await live.prompt("go")).toMatchObject({ disposition: "started" });
		const { interaction } = await live.waitFor("interaction_requested");
		expect(interaction.blocksRun).toBe(true);
		await live.control.answer(confirm(interaction.id, true));

		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(countOf(live, "run_started")).toBe(1);
		expect(t.state.answers).toEqual([true]);
		live.assertSettled();
	});
});

describe("a compaction Pi runs before the prompt", () => {
	test("starts the prompt's run, so the compaction is inside it and the prompt is not held for it", async () => {
		t = await HostRig.create();
		const live = await t.rig.rig.openNew({ modelId: wireIdOf(FAUX_MODEL_IDS.plain) });
		t.router.script(live.ref.sessionId, [say("x".repeat(16_000))]);
		await live.run("fill a large window");
		expect(count(live, "compaction_started")).toBe(0);
		expect(await live.control.setModel(wireIdOf(FAUX_MODEL_IDS.tiny))).toEqual({ status: "accepted" });

		const mark = live.recorder.items.length;
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect(await live.prompt("now in a tiny window")).toMatchObject({ disposition: "started" });
		expect((await live.waitFor("run_finished", () => true, mark)).outcome).toEqual({ kind: "completed" });
		const order = typesOf(live)
			.slice(mark)
			.filter((type) => ["run_started", "compaction_started", "compaction_finished", "run_finished"].includes(type));
		expect(order).toEqual(["run_started", "compaction_started", "compaction_finished", "run_finished"]);
		live.assertSettled();
	});
});

describe("an extension whose handler asks before it awaits anything, inside Pi's own call", () => {
	test("as the first session_start handler: the session opens with the ask, and the answer reaches it", async () => {
		t = await HostRig.create({ settings: { extensions: [] } });
		t.state.askOnStart = true;
		const live = await t.rig.rig.openNew();
		const [ask] = live.initial.interactions;
		if (!ask) throw new Error("the open's snapshot holds no ask");
		expect(ask).toMatchObject({ title: "Start?", blocksRun: false });

		expect(await live.control.answer(confirm(ask.id, true))).toEqual({ status: "accepted" });
		await live.waitFor("interaction_resolved", (event) => event.interactionId === ask.id);
		await t.rig.rig.arrange(live.ref, { kind: "reply" });
		expect(await promptOnceStarted(live, "now")).toMatchObject({ status: "accepted", disposition: "started" });
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		live.assertSettled();
	});

	test("as an input handler: the prompt is answered started, the ask names the run and blocks it", async () => {
		t = await HostRig.create();
		t.state.askOn = "input-at-once";
		const live = await t.rig.rig.openNew();
		await t.rig.rig.arrange(live.ref, { kind: "reply" });

		expect(await live.prompt("send this")).toEqual({ status: "accepted", disposition: "started" });
		const { interaction } = await live.waitFor("interaction_requested");
		const started = await live.waitFor("run_started");
		expect(interaction).toMatchObject({ title: "Send it?", runId: started.runId, blocksRun: true });

		await live.control.answer(confirm(interaction.id, true));
		expect((await live.waitFor("run_finished")).outcome).toEqual({ kind: "completed" });
		expect(t.state.answers).toEqual([true]);
		live.assertSettled();
	});
});
