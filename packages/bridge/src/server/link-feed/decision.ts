import type { ServerWebSocket } from "bun";
import { BackendId } from "../../contract";
import { toErrorMessage } from "../../http-utils";
import type { RouteRegistry } from "../../routing/registry";
import type { ServerDeps } from "../../routing/types";
import type { ClientMessage, ServerMessage } from "../../types";
import type { BroskiBackend } from "../../types/runtime";
import { applyContractDecision, type ContractAnswerer } from "./contract-decision";
import type { LinkFeedRequestRecord, LinkFeedRequests } from "./requests";

export type LinkDecision = {
	backend: string;
	session: string;
	request: string;
	decision: "allow" | "deny";
};

export type LinkDecisionOutcome = { ok: boolean; error: string | null };

export type LinkDecisionApplier = (
	decision: LinkDecision,
	ws: ServerWebSocket<unknown>,
) => Promise<LinkDecisionOutcome>;

export type LinkDecisionSources = {
	registry: RouteRegistry;
	serverDeps: ServerDeps;
	requests: LinkFeedRequests;
	contractAnswer: ContractAnswerer;
};

type Answer = { ok: true; message: ClientMessage } | { ok: false; error: string };

/** The daemon's decision frame, or null when the frame is not one. */
export function parseLinkDecision(frame: Record<string, unknown>): LinkDecision | null {
	const { backend, session, request, decision } = frame;
	if (typeof backend !== "string" || !backend) return null;
	if (typeof session !== "string") return null;
	if (typeof request !== "string" || !request) return null;
	if (decision !== "allow" && decision !== "deny") return null;
	return { backend, session, request, decision };
}

/** Applies decisions through the message handlers the phone's own response messages reach. */
export function createLinkDecisionApplier(sources: LinkDecisionSources): LinkDecisionApplier {
	return async (decision, ws) => {
		const record = sources.requests.find(decision.backend, decision.session, decision.request);
		if (record?.contract) {
			return await applyContractDecision(decision, record, record.contract, sources.requests, sources.contractAnswer);
		}
		const answer = answerOf(decision, record);
		if (!answer.ok) return { ok: false, error: answer.error };
		sources.requests.markAnswered(decision.backend, decision.session, decision.request);
		return await dispatch(answer.message, ws, sources);
	};
}

function answerOf(decision: LinkDecision, record: LinkFeedRequestRecord | undefined): Answer {
	if (!BackendId.safeParse(decision.backend).success) return { ok: false, error: "unknown backend" };
	if (!record) return { ok: false, error: "unknown request" };
	if (record.answered) return { ok: false, error: "already answered" };
	// A request for input needs an answer, not a decision.
	if (record.kind !== "approval") return { ok: false, error: "unsupported" };
	// Claude Code answers a question prompt with that prompt's own input, which a decision cannot carry.
	if (decision.backend === "claude-code" && record.requestKind === "AskUserQuestion") {
		return { ok: false, error: "unsupported" };
	}
	if (!isBroskiBackend(decision.backend)) return { ok: false, error: "unknown backend" };
	return { ok: true, message: responseMessage(decision) };
}

/** The message the phone sends to answer a Claude Code request, carrying the daemon's verdict. */
function responseMessage(decision: LinkDecision): ClientMessage {
	return {
		type: "cc_permission_response",
		sessionId: decision.session,
		toolUseId: decision.request,
		response: decision.decision === "allow" ? "once" : "reject",
		decisionClassification: decision.decision === "allow" ? "user_temporary" : "user_reject",
	};
}

async function dispatch(
	message: ClientMessage,
	ws: ServerWebSocket<unknown>,
	sources: LinkDecisionSources,
): Promise<LinkDecisionOutcome> {
	let reply: ServerMessage | null = null;
	try {
		await sources.registry.dispatch(message, {
			...sources.serverDeps,
			ws,
			reply: (response) => {
				reply ??= response;
			},
		});
	} catch (error) {
		return { ok: false, error: toErrorMessage(error) };
	}
	return outcomeOf(reply);
}

const BROSKI_BACKENDS: readonly string[] = ["claude-code"];

function isBroskiBackend(value: string): value is BroskiBackend {
	return BROSKI_BACKENDS.includes(value);
}

function outcomeOf(reply: ServerMessage | null): LinkDecisionOutcome {
	if (reply?.type === "error") return { ok: false, error: reply.message };
	return { ok: true, error: null };
}
