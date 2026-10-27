import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";
import { pendingElicitations } from "../server/pending-elicitation";
import type { ClientMessage } from "../types";

export type ClaudeElicitationReply = {
	action: "accept" | "decline" | "cancel";
	content?: Record<string, unknown>;
};

type WaiterEntry = {
	resolve: (response: ClaudeElicitationReply) => void;
	timer: Timer;
};

/**
 * Handles Claude Code elicitation responses from the mobile client.
 *
 * This keeps new CC interaction handling out of server.ts's giant switch.
 */
const ELICITATION_OPS = ["cc_elicitation_response"] as const;

export const MODULE_TYPES = ELICITATION_OPS;

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerAll(router, ELICITATION_OPS, async (message) => {
		handle(message, deps.ccElicitationWaiters);
	});
}

export function handle(message: ClientMessage, waiters: Map<string, WaiterEntry>): boolean {
	if (message.type !== "cc_elicitation_response") {
		return false;
	}

	const key = `${message.sessionId}:${message.requestId}`;
	const waiter = waiters.get(key);
	if (!waiter) {
		return true;
	}

	clearTimeout(waiter.timer);
	waiters.delete(key);
	pendingElicitations.forget(message.sessionId, message.requestId);

	const rawAction = message.action;
	const action: "accept" | "decline" | "cancel" =
		rawAction === "accept" || rawAction === "decline" || rawAction === "cancel" ? rawAction : "cancel";

	const content =
		message.content && typeof message.content === "object" && !Array.isArray(message.content)
			? (message.content as Record<string, unknown>)
			: undefined;

	waiter.resolve({
		action,
		...(content ? { content } : {}),
	});

	return true;
}
