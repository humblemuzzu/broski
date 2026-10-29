import { sessionCapabilities } from "../backend";
import type { Interaction } from "../interactions";
import { canonical, expect, fail, type LiveSession, promptInput, type Rig } from "./conformance-harness";
import { allTranscript } from "./conformance-reads";
import { validReply } from "./example-replies";
import { abortAndConfirm, holding } from "./rules-runs";

/**
 * Mid-run, `snapshot()` is the open snapshot plus the events, the active run carries what it has
 * finished so far while the transcript holds none of it, and a reopen gives the same live state.
 */
export async function snapshotsMatchTheEvents(rig: Rig): Promise<void> {
	const [kind] = rig.traits.interactions;
	const live = await rig.openNew();
	await rig.arrange(live.ref, kind ? { kind: "interaction", interaction: kind } : { kind: "hold" });
	const clientRequestId = crypto.randomUUID();
	await live.control.prompt(promptInput("Get going.", "start", clientRequestId));
	if (kind) await live.waitFor("interaction_requested");
	else await live.waitFor("block_finished");
	await rig.driver.quiesce();
	const reduced = live.reduced();
	expect(canonical(reduced) === canonical(live.session.snapshot()), "snapshot() differs from the events applied");
	expect(
		reduced.run?.items.some((item) => item.kind === "user_message" && item.clientRequestId === clientRequestId) ===
			true,
		"the active run does not carry its prompt",
	);
	expect(!(await inTranscript(rig, live, clientRequestId)), "the transcript holds the active run");
	await live.close();
	const reopened = await rig.open(live.ref);
	expect(canonical(reopened.initial) === canonical(reduced), "reopening gives a different live state");
	expect(
		canonical(sessionCapabilities(reopened.session)) === canonical(sessionCapabilities(live.session)),
		"capabilities changed",
	);
	await abortAndConfirm(reopened);
	expect(await inTranscript(rig, live, clientRequestId), "the finished run is not in the transcript");
}

async function inTranscript(rig: Rig, live: LiveSession, clientRequestId: string): Promise<boolean> {
	const items = await allTranscript(rig.backend, live.ref, 200);
	return items.some((item) => item.kind === "user_message" && item.clientRequestId === clientRequestId);
}

export async function closeDetachesWithoutAborting(rig: Rig): Promise<void> {
	const live = await holding(rig);
	const started = await live.waitFor("run_started");
	await live.close();
	await live.close();
	const afterClose = await live.control.prompt(promptInput("Too late.", "start", crypto.randomUUID()));
	expect(afterClose.status === "rejected" && afterClose.rejection.code === "closed", "a closed session must reject");
	await rig.driver.quiesce();
	expect(live.recorder.recordsAfterClose() === 0, "events arrived after close()");
	const reopened = await rig.open(live.ref);
	expect(reopened.initial.run?.runId === started.runId, "closing the session ended its run");
	await abortAndConfirm(reopened);
	await aPendingAskOutlivesClose(rig);
}

/** An ask pending at close is in the next open's snapshot and can be answered there. */
async function aPendingAskOutlivesClose(rig: Rig): Promise<void> {
	const [kind] = rig.traits.interactions;
	if (!kind) return;
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "interaction", interaction: kind });
	await live.prompt("Ask me, then wait.");
	const requested = await live.waitFor("interaction_requested");
	await live.close();
	const reopened = await rig.open(live.ref);
	const pending: Interaction | undefined = reopened.initial.interactions.find(
		(interaction) => interaction.id === requested.interaction.id,
	);
	if (!pending) fail("an ask pending at close is not in the next open's snapshot");
	const result = await reopened.control.answer({ interactionId: pending.id, reply: validReply(pending) });
	expect(result.status === "accepted", "an ask pending at close cannot be answered after reopening");
	const resolved = await reopened.waitFor("interaction_resolved", (event) => event.interactionId === pending.id);
	expect(resolved.reason === "answered", `the reopened ask resolved ${resolved.reason}`);
	await reopened.waitFor("run_finished");
	reopened.assertSettled();
}

export async function disposeSilencesEverything(rig: Rig): Promise<void> {
	const live = await holding(rig);
	await rig.backend.dispose();
	const sessionEvents = live.recorder.items.length;
	const catalogEvents = rig.catalog.items.length;
	await rig.backend.dispose();
	await rig.driver.quiesce();
	expect(live.recorder.items.length === sessionEvents, "a session emitted after dispose()");
	expect(rig.catalog.items.length === catalogEvents, "the catalog emitted after dispose()");
}

/** With `externalLive`, a run another client starts is reported as it happens. */
export async function externalRunsAreLive(rig: Rig): Promise<void> {
	if (!rig.traits.externalLive) return;
	const live = await rig.openNew();
	expect(await rig.driver.runExternally(live.ref), "externalLive is declared but no other client can run");
	const started = await live.waitFor("run_started");
	expect(started.trigger === "external", `another client's run started with trigger ${started.trigger}`);
	await live.waitFor("run_finished", (event) => event.runId === started.runId);
	live.assertSettled();
}

/** A run survives a restart of the bridge exactly when `durableRuns` says so; the session survives always. */
export async function runsSurviveARestartWhenDurable(rig: Rig): Promise<void> {
	const durable = rig.traits.durableRuns;
	const live = await holding(rig);
	const started = await live.waitFor("run_started");
	await rig.restart();
	const found = await rig.backend.getSession(live.ref);
	expect(found.status === "accepted", "the session did not survive a restart of the bridge");
	const reopened = await rig.open(live.ref);
	const survived = reopened.initial.run !== undefined;
	expect(
		survived === durable,
		`durableRuns is ${durable} but the run ${survived ? "survived" : "ended with"} the restart`,
	);
	if (survived) {
		expect(reopened.initial.run?.runId === started.runId, "the run that survived has another id");
		await abortAndConfirm(reopened);
	}
}
