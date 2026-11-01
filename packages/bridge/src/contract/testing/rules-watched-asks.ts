import type { InteractionId } from "../ids";
import type { ActionResult } from "../input";
import type { InteractionReply } from "../interaction-replies";
import type { Interaction } from "../interactions";
import { canonical, expect, fail, type LiveSession, type Rig } from "./conformance-harness";
import { invalidReplies, validReply } from "./example-replies";

/**
 * A session answers through one path: one with `control` has no `answer` of its own. A session another client owns,
 * opened without `control` but with `answer` (`watchedAsk`), checks every answer, resolves its ask once, and refuses
 * `closed` once closed.
 */
export async function watchedAsksAreAnsweredOnce(rig: Rig): Promise<void> {
	const own = await rig.openNew();
	expect(own.session.answer === undefined, "a session with control offers a second way to answer");
	const ref = await rig.driver.watchedAsk?.();
	if (!ref) return;
	await rig.driver.quiesce();
	const live = await rig.open(ref);
	expect(live.session.control === undefined, "the session the driver asked in from elsewhere can be controlled");
	expect(live.session.answer !== undefined, "the watched session takes no answers");
	const interaction = await pendingAsk(live);
	await answersAreChecked(live, interaction);
	await live.close();
	const late = await answer(live, interaction.id, validReply(interaction));
	expect(
		late.status === "rejected" && late.rejection.code === "closed",
		"an answer after close must be rejected closed",
	);
	live.assertValid();
}

async function pendingAsk(live: LiveSession): Promise<Interaction> {
	const [first] = live.initial.interactions;
	return first ?? (await live.waitFor("interaction_requested")).interaction;
}

async function answersAreChecked(live: LiveSession, interaction: Interaction): Promise<void> {
	for (const reply of invalidReplies(interaction)) {
		const result = await answer(live, interaction.id, reply);
		expect(
			result.status === "rejected" && result.rejection.code === "invalid_input",
			`watched: the invalid answer ${canonical(reply)} was not rejected invalid_input`,
		);
	}
	expect(
		live.session.snapshot().interactions.some((pending) => pending.id === interaction.id),
		"watched: an invalid answer resolved the interaction",
	);
	const valid = validReply(interaction);
	expect((await answer(live, interaction.id, valid)).status === "accepted", "watched: a valid answer was rejected");
	const resolved = await live.waitFor("interaction_resolved", (event) => event.interactionId === interaction.id);
	expect(resolved.reason === "answered", `watched: the ask resolved ${resolved.reason}, expected answered`);
	const repeat = await answer(live, interaction.id, valid);
	expect(repeat.status === "rejected" && repeat.rejection.code === "stale", "watched: a second answer must be stale");
}

function answer(live: LiveSession, interactionId: InteractionId, reply: InteractionReply): Promise<ActionResult> {
	const answered = live.session.answer?.({ interactionId, reply });
	return answered ?? fail("the watched session takes no answers");
}
