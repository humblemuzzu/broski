import type { Rejected } from "../../../contract";
import { rejected } from "../rejections";

/**
 * Why Pi refused a prompt, from the error its `prompt` answers with (pi-coding-agent 1.5.2
 * `dist/core/agent-session.js:1712-1776`, `dist/core/auth-guidance.js:14-20`). Those messages end in advice for a
 * terminal, which a phone cannot follow.
 */
export function promptRejection(message: string): Rejected {
	if (
		message.startsWith("Agent is already processing") ||
		message.startsWith("Cannot submit a prompt while compaction")
	) {
		return rejected("busy", firstParagraph(message));
	}
	if (message.startsWith("No model selected")) return rejected("no_model", "No model is selected for this session.");
	if (message.startsWith("No API key found") || message.startsWith("Authentication failed")) {
		return rejected("auth", firstParagraph(message));
	}
	return rejected("backend_error", message);
}

function firstParagraph(message: string): string {
	return message.split("\n\n")[0] ?? message;
}
