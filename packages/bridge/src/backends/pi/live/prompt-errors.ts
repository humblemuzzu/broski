import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected } from "../../../contract";

/**
 * What Pi's auth check says of the placeholder a session with no model holds (`selectedModel`): its provider is
 * "unknown", which `formatNoApiKeyFoundMessage` words as "the selected model" (`dist/core/auth-guidance.js:3,17-19`).
 */
const NO_MODEL_SELECTED = "No API key found for the selected model";

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
	if (message.startsWith(NO_MODEL_SELECTED))
		return rejected("no_model", "Pi has no model to run: no provider is signed in.");
	if (message.startsWith("No API key found") || message.startsWith("Authentication failed")) {
		return rejected("auth", firstParagraph(message));
	}
	return rejected("backend_error", message);
}

function firstParagraph(message: string): string {
	return message.split("\n\n")[0] ?? message;
}
