import type { ActionResult, InteractionAnswer, RejectionCode, SessionRef } from "../../contract";
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
	const result = await answer(target.session, { interactionId: target.interaction, reply });
	if (!endsRequest(result)) requests.reopen(decision.backend, decision.session, decision.request);
	return outcomeOf(result);
}

/** The request is over once answered, or once the core says nothing is there to answer; any other refusal may pass. */
function endsRequest(result: ActionResult): boolean {
	return result.status === "accepted" || isGone(result.rejection.code);
}

function isGone(code: RejectionCode): boolean {
	return code === "stale" || code === "not_found" || code === "closed";
}

function outcomeOf(result: ActionResult): LinkDecisionOutcome {
	if (result.status === "accepted") return { ok: true, error: null };
	const { code, message } = result.rejection;
	return refusal(isGone(code) ? "no longer pending" : message);
}

function refusal(error: string): LinkDecisionOutcome {
	return { ok: false, error };
}
