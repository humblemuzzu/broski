import type { InteractionId } from "../ids";
import type { InteractionReply, ResolutionReason } from "../interaction-replies";
import type { Interaction, InteractionKind } from "../interactions";
import { canonical, expect, type LiveSession, type Rig } from "./conformance-harness";
import { invalidReplies, validReply } from "./example-replies";

/**
 * For every declared kind: invalid answers are refused and change nothing, a valid answer resolves
 * the interaction once and the run goes on, a repeat answer is stale, and a cancel ends the run
 * exactly when it says so.
 */
export async function declaredInteractionsAnswerCorrectly(rig: Rig): Promise<void> {
	for (const kind of rig.traits.interactions) {
		await answersAreChecked(rig, kind);
		await cancelStopsTheRun(rig, kind, true);
		await cancelStopsTheRun(rig, kind, false);
		await abortWithdrawsThePendingAsk(rig, kind);
	}
}

async function answersAreChecked(rig: Rig, kind: InteractionKind): Promise<void> {
	const { live, interaction } = await asked(rig, kind);
	for (const reply of invalidReplies(interaction)) {
		const result = await answer(live, interaction.id, reply);
		expect(
			result.status === "rejected" && result.rejection.code === "invalid_input",
			`${kind}: the invalid answer ${canonical(reply)} was not rejected invalid_input`,
		);
	}
	expect(
		live.session.snapshot().interactions.some((pending) => pending.id === interaction.id),
		`${kind}: an invalid answer resolved the interaction`,
	);
	const valid = validReply(interaction);
	expect((await answer(live, interaction.id, valid)).status === "accepted", `${kind}: a valid answer was rejected`);
	await resolvedAs(live, interaction.id, "answered");
	const repeat = await answer(live, interaction.id, valid);
	expect(repeat.status === "rejected" && repeat.rejection.code === "stale", `${kind}: a second answer must be stale`);
	const finished = await live.waitFor("run_finished");
	expect(finished.outcome.kind !== "aborted", `${kind}: the run was aborted after a valid answer`);
	live.assertSettled();
}

async function cancelStopsTheRun(rig: Rig, kind: InteractionKind, stopRun: boolean): Promise<void> {
	const { live, interaction } = await asked(rig, kind);
	const result = await answer(live, interaction.id, { kind: "cancel", stopRun });
	expect(result.status === "accepted", `${kind}: cancel was rejected`);
	await resolvedAs(live, interaction.id, "answered");
	const finished = await live.waitFor("run_finished");
	const aborted = finished.outcome.kind === "aborted";
	expect(aborted === stopRun, `${kind}: cancel with stopRun ${stopRun} ended the run ${finished.outcome.kind}`);
	live.assertSettled();
}

async function abortWithdrawsThePendingAsk(rig: Rig, kind: InteractionKind): Promise<void> {
	const { live, interaction } = await asked(rig, kind);
	expect((await live.control.abort()).status === "accepted", `${kind}: abort was rejected`);
	await resolvedAs(live, interaction.id, "withdrawn");
	const finished = await live.waitFor("run_finished");
	expect(finished.outcome.kind === "aborted", `${kind}: an aborted run ended ${finished.outcome.kind}`);
	live.assertSettled();
}

async function asked(rig: Rig, kind: InteractionKind): Promise<{ live: LiveSession; interaction: Interaction }> {
	const live = await rig.openNew();
	await rig.arrange(live.ref, { kind: "interaction", interaction: kind });
	const result = await live.prompt("Ask me.");
	expect(result.status === "accepted", `${kind}: the prompt was rejected`);
	const requested = await live.waitFor("interaction_requested");
	expect(requested.interaction.request.kind === kind, `asked a ${requested.interaction.request.kind}, not a ${kind}`);
	expect(
		live.session.snapshot().interactions.some((pending) => pending.id === requested.interaction.id),
		`${kind}: the pending interaction is not in snapshot()`,
	);
	return { live, interaction: requested.interaction };
}

function answer(live: LiveSession, interactionId: InteractionId, reply: InteractionReply) {
	return live.control.answer({ interactionId, reply });
}

async function resolvedAs(live: LiveSession, interactionId: InteractionId, reason: ResolutionReason): Promise<void> {
	const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === interactionId);
	expect(resolved.reason === reason, `the interaction resolved ${resolved.reason}, expected ${reason}`);
}
