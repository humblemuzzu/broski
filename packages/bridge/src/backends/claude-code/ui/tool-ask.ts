/** What every `canUseTool` ask shares: its shape, and the answers a human's cancel and a withdrawal give the CLI. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { CancelReply, InteractionReply, InteractionRequest } from "../../../contract";
import { humanDenial } from "./denial";

export interface ToolAsk {
	readonly title: string;
	readonly body?: string;
	readonly request: InteractionRequest;
	/** The CLI's answer to a human's reply; undefined when the reply cannot become one. Cancel is handled by the desk. */
	readonly decide: (reply: InteractionReply) => PermissionResult | undefined;
}

/** The CLI withdrew the ask or its run is over: nobody is waiting for this any more. */
export const WITHDRAWN: PermissionResult = { behavior: "deny", message: "The request was withdrawn." };

/** A human dismissed the ask: a plain denial, or one that also interrupts the turn when they chose to stop the run. */
function cancelledToolAsk(reply: CancelReply): PermissionResult {
	return {
		behavior: "deny",
		message: humanDenial(reply.message),
		...(reply.stopRun && { interrupt: true }),
	};
}

export function textOr(text: string | undefined, fallback: string): string {
	return text !== undefined && text.trim() !== "" ? text : fallback;
}

export function deciding(ask: ToolAsk, reply: InteractionReply): PermissionResult | undefined {
	return reply.kind === "cancel" ? cancelledToolAsk(reply) : ask.decide(reply);
}
