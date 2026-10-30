import type { Rejected } from "../../../contract";
import { errorText } from "../error-text";
import { rejected } from "../rejections";

/**
 * Why `AgentSession.prompt` refused, from the messages it throws: pi `src/core/agent-session.ts:2111`
 * (compaction), `:2139` (already processing), `:2154` and `:2169` with `src/core/auth-guidance.ts:18-25`
 * (no model, no key), `:2163` (expired sign-in). Those messages end in a path to Pi's docs, which a phone cannot open.
 */
export function promptRejection(error: unknown): Rejected {
	const message = errorText(error);
	if (
		message.startsWith("Agent is already processing") ||
		message.startsWith("Cannot submit a prompt while compaction")
	) {
		return rejected("busy", message);
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
