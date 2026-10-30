import type { ActionResult, InteractionAnswer, SessionRef } from "../../contract";
import type { LinkDecision, LinkDecisionOutcome } from "./decision";
import type { LinkFeedContractTarget, LinkFeedRequestRecord, LinkFeedRequests } from "./requests";

/** Where a verdict on a contract session's alert goes: the core, as a person's answer. */
export type ContractAnswerer = (session: SessionRef, answer: InteractionAnswer) => Promise<ActionResult>;

/**
 * Applies the daemon's verdict to a contract session's alert. It answers only what the person
 * decided: the plain allow-once or deny-once the request offered, once, through the core's checks.
 */
export async function applyContractDecision(
	decision: LinkDecision,
	record: LinkFeedRequestRecord,
	target: LinkFeedContractTarget,
	requests: LinkFeedRequests,
	answer: ContractAnswerer,
): Promise<LinkDecisionOutcome> {
	if (record.answered) return refusal("already answered");
	if (record.withdrawn) return refusal("no longer pending");
	if (record.kind !== "approval") return refusal("unsupported");
	const reply = decision.decision === "allow" ? target.replies.allow : target.replies.deny;
	if (!reply) return refusal("unsupported");
	requests.markAnswered(decision.backend, decision.session, decision.request);
	return outcomeOf(await answer(target.session, { interactionId: target.interaction, reply }));
}

function outcomeOf(result: ActionResult): LinkDecisionOutcome {
	if (result.status === "accepted") return { ok: true, error: null };
	const { code, message } = result.rejection;
	return refusal(code === "stale" || code === "not_found" ? "no longer pending" : message);
}

function refusal(error: string): LinkDecisionOutcome {
	return { ok: false, error };
}
