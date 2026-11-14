import { BackendId } from "../../contract";
import { applyContractDecision, type ContractAnswerer } from "./contract-decision";
import type { LinkFeedRequests } from "./requests";

export type LinkDecision = {
	backend: string;
	session: string;
	request: string;
	decision: "allow" | "deny";
};

export type LinkDecisionOutcome = { ok: boolean; error: string | null };

export type LinkDecisionApplier = (decision: LinkDecision) => Promise<LinkDecisionOutcome>;

/** The daemon's decision frame, or null when the frame is not one. */
export function parseLinkDecision(frame: Record<string, unknown>): LinkDecision | null {
	const { backend, session, request, decision } = frame;
	if (typeof backend !== "string" || !backend) return null;
	if (typeof session !== "string") return null;
	if (typeof request !== "string" || !request) return null;
	if (decision !== "allow" && decision !== "deny") return null;
	return { backend, session, request, decision };
}

/** Applies a verdict to the alert it names, through the core, as a person's answer. */
export function createLinkDecisionApplier(requests: LinkFeedRequests, answer: ContractAnswerer): LinkDecisionApplier {
	return async (decision) => {
		if (!BackendId.safeParse(decision.backend).success) return { ok: false, error: "unknown backend" };
		const record = requests.find(decision.backend, decision.session, decision.request);
		if (!record) return { ok: false, error: "unknown request" };
		return await applyContractDecision(decision, record, record.contract, requests, answer);
	};
}
