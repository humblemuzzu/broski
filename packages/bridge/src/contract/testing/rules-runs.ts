import type { PromptMode } from "../input";
import { canonical, expect, fail, type LiveSession, type Rig } from "./conformance-harness";
import type { Feature } from "./conformance-types";

export async function aRunStreamsAndEnds(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	const { outcome, clientRequestId } = await live.run("Answer briefly.");
	expect(outcome.kind === "completed", `the run ended ${outcome.kind}`);
	live.assertSettled();
	const events = live.events();
	expect(events.filter((event) => event.type === "run_started").length === 1, "one prompt started more than one run");
	expect(
		events.some((event) => event.type === "user_message" && event.clientRequestId === clientRequestId),
		"the prompt's user message does not carry its clientRequestId",
	);
	const textBlocks = new Set(
		events.flatMap((event) => (event.type === "block_started" && event.kind === "text" ? [event.blockId] : [])),
	);
	const answer = events.find(
		(event) => event.type === "block_finished" && textBlocks.has(event.blockId) && event.text !== "",
	);
	expect(answer !== undefined, "the run produced no text");
	if (rig.traits.streamText) {
		const streamed = events.some((event) => event.type === "block_delta" && textBlocks.has(event.blockId));
		expect(streamed, "streamText is declared but no text delta was sent");
	}
}

export async function aToolCallStartsAndFinishes(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "tool" });
	await live.run("Use a tool.");
	live.assertSettled();
	expect(
		live.events().some((event) => event.type === "tool_started"),
		"no tool started",
	);
}

/** Every declared feature can be shown, and shows as the event the contract names for it. */
export async function declaredFeaturesAppear(rig: Rig): Promise<void> {
	const features: [Feature, boolean, (live: LiveSession) => boolean][] = [
		["thinking", rig.traits.streamThinking, (live) => thinkingStreamed(live)],
		["usage", rig.traits.usage, (live) => live.events().some((event) => event.type === "usage_updated")],
		["plan", rig.traits.plan, (live) => live.events().some((event) => event.type === "plan_updated")],
		[
			"plan_proposal",
			rig.traits.planProposals,
			(live) => live.events().some((e) => e.type === "block_started" && e.kind === "plan"),
		],
		["children", rig.traits.children, (live) => childSessionShown(live)],
	];
	for (const [feature, declared, shown] of features) {
		if (!declared) continue;
		const live = await rig.openNew();
		await rig.arrange(live.ref, { kind: "feature", feature });
		await live.run(`Show ${feature}.`);
		live.assertSettled();
		expect(shown(live), `${feature} is declared but the run did not show it`);
	}
}

function thinkingStreamed(live: LiveSession): boolean {
	const events = live.events();
	const thinking = new Set(
		events.flatMap((event) => (event.type === "block_started" && event.kind === "thinking" ? [event.blockId] : [])),
	);
	return events.some((event) => event.type === "block_delta" && thinking.has(event.blockId));
}

function childSessionShown(live: LiveSession): boolean {
	return live.events().some((event) => event.type === "tool_updated" && event.update.kind === "child_session");
}

/** An accepted prompt is remembered by its id; a rejected one is not, so it can be sent again once the run ends. */
export async function aRepeatedPromptRunsOnce(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "reply" });
	const clientRequestId = crypto.randomUUID();
	const first = await live.prompt("Once only.", "start", clientRequestId);
	const again = await live.prompt("Once only.", "start", clientRequestId);
	expect(canonical(first) === canonical(again), "a repeated prompt got a different result");
	await live.runAfter(0);
	await rig.driver.quiesce();
	const events = live.events();
	const messages = events.filter((event) => event.type === "user_message" && event.clientRequestId === clientRequestId);
	expect(messages.length === 1, `a repeated prompt reached the model ${messages.length} times`);
	expect(events.filter((event) => event.type === "run_started").length === 1, "a repeated prompt started another run");
	live.assertSettled();
	await aRejectedPromptCanBeSentAgain(rig);
}

async function aRejectedPromptCanBeSentAgain(rig: Rig): Promise<void> {
	const live = await holding(rig);
	const clientRequestId = crypto.randomUUID();
	const busy = await live.prompt("After this run.", "start", clientRequestId);
	expect(busy.status === "rejected" && busy.rejection.code === "busy", "start during a run must be rejected busy");
	await abortAndConfirm(live);
	await rig.arrange(live.ref, { kind: "reply" });
	const mark = live.recorder.items.length;
	const retried = await live.prompt("After this run.", "start", clientRequestId);
	expect(
		retried.status === "accepted" && retried.disposition === "started",
		`a prompt rejected busy was remembered: ${canonical(retried)}`,
	);
	await live.runAfter(mark);
	live.assertSettled();
}

export async function startWhileRunningIsBusy(rig: Rig): Promise<void> {
	const live = await holding(rig);
	const result = await live.prompt("Another one.", "start");
	expect(result.status === "rejected" && result.rejection.code === "busy", "start during a run must be rejected busy");
	await abortAndConfirm(live);
}

export async function steerJoinsTheRun(rig: Rig): Promise<void> {
	if (!rig.traits.promptModes.includes("steer")) return unsupportedMode(rig, "steer");
	const live = await holding(rig);
	const result = await live.prompt("Also do this.", "steer");
	expect(
		result.status === "accepted" && result.disposition === "steered",
		`steer was not steered: ${canonical(result)}`,
	);
	await abortAndConfirm(live);
}

export async function queuedInputCanBeSeenAndCancelled(rig: Rig): Promise<void> {
	if (!rig.traits.promptModes.includes("queue")) return unsupportedMode(rig, "queue");
	const live = await holding(rig);
	const clientRequestId = crypto.randomUUID();
	const result = await live.prompt("Afterwards.", "queue", clientRequestId);
	if (result.status !== "accepted" || result.disposition !== "queued")
		fail(`queue was not queued: ${canonical(result)}`);
	const control = live.control;
	const queueItemId = result.queueItemId;
	if (rig.traits.queue || control.cancelQueued) {
		if (queueItemId === undefined) fail("a backend that shows or cancels queued input must name the queued item");
		if (rig.traits.queue) {
			await live.waitFor("queue_changed", (event) =>
				event.items.some((item) => item.id === queueItemId && item.clientRequestId === clientRequestId),
			);
		}
		if (control.cancelQueued) {
			expect(
				(await control.cancelQueued(queueItemId)).status === "accepted",
				"cancelling the queued item was rejected",
			);
			if (rig.traits.queue) {
				await live.waitFor("queue_changed", (event) => !event.items.some((item) => item.id === queueItemId));
			}
			const again = await control.cancelQueued(queueItemId);
			expect(again.status === "rejected", "cancelling twice must be rejected");
		}
	}
	await abortAndConfirm(live);
}

export async function abortEndsTheRun(rig: Rig): Promise<void> {
	const idle = await rig.openNew();
	expect((await idle.control.abort()).status === "accepted", "abort with no run must be accepted");
	await rig.driver.quiesce();
	expect(idle.recorder.items.length === 0, "abort with no run emitted events");
	await abortAndConfirm(await holding(rig));
}

/** A new session whose run is under way and waits at a hold. */
export async function holding(rig: Rig): Promise<LiveSession> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "hold" });
	const result = await live.prompt("Work for a while.");
	expect(result.status === "accepted" && result.disposition === "started", "the run did not start");
	await live.waitFor("run_started");
	return live;
}

export async function abortAndConfirm(live: LiveSession): Promise<void> {
	const runId = live.reduced().run?.runId;
	expect(runId !== undefined, "no run is active to abort");
	expect((await live.control.abort()).status === "accepted", "abort was rejected");
	const finished = await live.waitFor("run_finished", (event) => event.runId === runId);
	expect(finished.outcome.kind === "aborted", `an aborted run ended ${finished.outcome.kind}`);
	live.assertSettled();
}

async function unsupportedMode(rig: Rig, mode: PromptMode): Promise<void> {
	const live = await rig.openNew();
	const result = await live.prompt("Unsupported.", mode);
	expect(
		result.status === "rejected" && result.rejection.code === "unsupported",
		`${mode} is not declared yet accepted`,
	);
}
