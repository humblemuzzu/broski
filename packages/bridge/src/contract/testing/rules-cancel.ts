import { expect, type LiveSession, type Rig } from "./conformance-harness";

/** A session that can cancel a compaction or a retry does it on its own: nothing else ends, and nothing is left open. */
export async function compactionAndRetryCanBeCancelled(rig: Rig): Promise<void> {
	const { cancelCompaction, cancelRetry } = (await rig.openNew()).control;
	if (cancelCompaction) await compactionCancels(rig);
	if (cancelRetry) await retryCancels(rig);
}

async function acceptedAndSilent(
	rig: Rig,
	live: LiveSession,
	what: string,
	cancel: () => Promise<{ status: string }>,
): Promise<void> {
	const mark = live.recorder.items.length;
	expect((await cancel()).status === "accepted", `cancelling a ${what} with none under way must be accepted`);
	await rig.driver.quiesce();
	expect(live.recorder.items.length === mark, `cancelling a ${what} with none under way emitted events`);
}

async function compactionCancels(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	const { compact, cancelCompaction } = live.control;
	expect(compact !== undefined && cancelCompaction !== undefined, "a session that cancels a compaction must compact");
	await acceptedAndSilent(rig, live, "compaction", () => cancelCompaction());
	await rig.arrange(live.ref, { kind: "reply" });
	await live.run("Leave something to compact.");
	await rig.arrange(live.ref, { kind: "slow_compaction" });

	const mark = live.recorder.items.length;
	expect((await compact(undefined)).status === "accepted", "compact was rejected");
	await live.waitFor("compaction_started", () => true, mark);
	expect((await cancelCompaction()).status === "accepted", "cancelling the compaction was rejected");
	const finished = await live.waitFor("compaction_finished", () => true, mark);
	expect(finished.outcome.kind === "aborted", `a cancelled compaction finished ${finished.outcome.kind}`);
	await rig.driver.quiesce();
	live.assertSettled();

	await rig.driver.release(live.ref);
	const again = live.recorder.items.length;
	expect((await compact(undefined)).status === "accepted", "compacting again after a cancel was rejected");
	const second = await live.waitFor("compaction_finished", () => true, again);
	expect(second.outcome.kind === "completed", `the compaction after a cancel finished ${second.outcome.kind}`);
}

async function retryCancels(rig: Rig): Promise<void> {
	const live = await rig.openNew();
	const cancelRetry = live.control.cancelRetry;
	if (!cancelRetry) return;
	await acceptedAndSilent(rig, live, "retry", () => cancelRetry());
	await rig.arrange(live.ref, { kind: "slow_retry" });

	const mark = live.recorder.items.length;
	const sent = await live.prompt("Fail once, then recover.");
	expect(sent.status === "accepted" && sent.disposition === "started", "the run did not start");
	await live.waitFor("retry_scheduled", () => true, mark);
	expect((await cancelRetry()).status === "accepted", "cancelling the retry was rejected");
	const finished = await live.waitFor("retry_finished", () => true, mark);
	expect(!finished.succeeded, "a cancelled retry finished successfully");
	const ended = await live.waitFor("run_finished", () => true, mark);
	expect(ended.outcome.kind !== "completed", "a run whose retry was cancelled carried on as if it had succeeded");
	live.assertSettled();
}
