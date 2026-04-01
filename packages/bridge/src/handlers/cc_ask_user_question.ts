/**
 * CC AskUserQuestion interceptor.
 *
 * AskUserQuestion is YOLO-allowlisted in CC — canUseTool never fires for it.
 * The PreToolUse hook DOES fire and can carry updatedInput back to CC.
 * However, as a fallback, we also intercept the tool-call streaming event
 * and emit a synthetic permission-request. This ensures the questionnaire
 * sheet shows on the phone even if the hook path has issues.
 *
 * The hook path is preferred (it can send answers back to CC).
 * The synthetic path is a fallback (shows the sheet, but answer may not
 * reach CC if the hook didn't fire or failed).
 */
import type { ClaudeCodeStreamMessage } from "../types";

// Track which AskUserQuestion tool calls we've already synthesized
// permission-request events for, to avoid duplicates.
const emittedAskUserQuestions = new Set<string>();

/**
 * Check if a CC stream message is an AskUserQuestion tool-call that needs
 * a synthetic permission-request. Returns the permission-request message
 * to emit, or null if not applicable.
 */
export function maybeSynthesizeAskUserQuestion(
	sessionId: string,
	streamMsg: ClaudeCodeStreamMessage,
): ClaudeCodeStreamMessage | null {
	if (streamMsg.type !== "tool-call") return null;
	if (streamMsg.tool !== "AskUserQuestion") return null;
	if (streamMsg.status !== "running") return null;

	const toolUseId = streamMsg.toolUseId;
	if (!toolUseId) return null;

	// Dedup: only emit once per tool use
	const key = `${sessionId}:${toolUseId}`;
	if (emittedAskUserQuestions.has(key)) return null;
	emittedAskUserQuestions.add(key);

	// Prevent unbounded growth
	if (emittedAskUserQuestions.size > 500) {
		const entries = [...emittedAskUserQuestions];
		for (let i = 0; i < 250; i++) {
			emittedAskUserQuestions.delete(entries[i]!);
		}
	}

	return {
		type: "permission-request",
		sessionId,
		toolUseId,
		tool: "AskUserQuestion",
		input: streamMsg.input ?? {},
		title: "Claude has a question",
		description: "Claude wants to ask you a question",
	} as ClaudeCodeStreamMessage;
}
