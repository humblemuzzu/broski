import {
	type ActionResult,
	type AgentEvent,
	answerProblem,
	type InteractionAnswer,
	type SessionAnswerer,
} from "../contract";
import { BoundedMap } from "../state/bounded-map";
import type { LiveSession } from "./live-session";
import { rejected } from "./results";
import { sessionScopedKey } from "./session-key";

/** Resolved interactions remembered so a late answer is told `stale`, not `not_found`. */
const RESOLVED_MEMORY = 10_000;

/**
 * Where every answer from a phone goes. It is checked with `answerProblem` before any adapter sees
 * it, and the first answer to reach an interaction is the only one forwarded: the others get
 * `stale`, and every viewer sees the resolution as the adapter's `interaction_resolved`.
 *
 * Nothing here answers on anyone's behalf. An interaction ends only when a human answers or
 * cancels it, or the backend withdraws it or lets it expire. There is no timeout: a phone may come
 * back hours later and the ask is still there, in the snapshot of every attach.
 */
export class InteractionDesk {
	private readonly resolved = new BoundedMap<string, true>({ maxEntries: RESOLVED_MEMORY });

	async answer(live: LiveSession, answerer: SessionAnswerer, answer: InteractionAnswer): Promise<ActionResult> {
		const id = answer.interactionId;
		const interaction = live.snapshot.interactions.find((pending) => pending.id === id);
		if (!interaction) {
			return this.resolved.has(sessionScopedKey(live.ref, id))
				? rejected("stale", "this interaction is already resolved")
				: rejected("not_found", `no interaction ${id} is pending`);
		}
		const problem = answerProblem(interaction, answer);
		if (problem !== undefined) return rejected("invalid_input", problem);
		if (live.claims.has(id)) return rejected("stale", "another answer to this interaction is already on its way");
		live.claims.add(id);
		try {
			const result = await answerer.answer(answer);
			if (result.status === "rejected") live.claims.delete(id);
			return result;
		} catch (error) {
			live.claims.delete(id);
			throw error;
		}
	}

	/** The hub's view of every event: a resolution ends the claim and is remembered. */
	observe(live: LiveSession, event: AgentEvent): void {
		if (event.type !== "interaction_resolved") return;
		live.claims.delete(event.interactionId);
		this.resolved.set(sessionScopedKey(live.ref, event.interactionId), true);
	}
}
