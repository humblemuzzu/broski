/** Lane E · MCP elicitation (D13): flat form → `form`, empty schema → `confirm`, url → `external_url`. */

import type { ElicitationRequest, ElicitationResult } from "@anthropic-ai/claude-agent-sdk";
import type { ConfirmRequest, ExternalUrlRequest, FormRequest, InteractionReply } from "../../../contract";

/** Undefined for a schema the contract's forms cannot hold (nested): declined with a notice, never answered silently. */
export function elicitationRequest(
	_request: ElicitationRequest,
): FormRequest | ExternalUrlRequest | ConfirmRequest | undefined {
	return undefined;
}

export function elicitationResult(
	_request: ElicitationRequest,
	_reply: InteractionReply,
): ElicitationResult | undefined {
	return undefined;
}
