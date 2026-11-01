/** Lane E · the `AskDesk` each host creates (D13, D14): one interaction per CLI ask, resolved exactly once. */

import type { CanUseTool, OnElicitation, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AskDesk, AskDeskFactory, AskHost } from "../ports/asks";
import { notBuilt } from "../rejections";

/** Until lane E builds the desk nothing can answer, so an ask waits for the CLI to withdraw it. */
function withdrawn(signal: AbortSignal): Promise<PermissionResult> {
	return new Promise((resolve) => {
		signal.addEventListener("abort", () => resolve({ behavior: "deny", message: "withdrawn" }), { once: true });
	});
}

export const createAskDesk: AskDeskFactory = (_host: AskHost): AskDesk => {
	const canUseTool: CanUseTool = (_tool, _input, options) => withdrawn(options.signal);
	const onElicitation: OnElicitation = (_request, options) =>
		withdrawn(options.signal).then(() => ({ action: "cancel" }));
	return {
		canUseTool,
		onElicitation,
		answer: () => notBuilt("lane E: answer"),
		elicitationComplete: () => undefined,
		withdrawRun: () => undefined,
		expireAll: () => undefined,
	};
};
