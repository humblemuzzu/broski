/** Lane E · AskUserQuestion as `questions` (D13): ids by index, answers keyed by question text, multi-select joined. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { QuestionsReply, QuestionsRequest } from "../../../contract";

export function questionsRequest(_input: Record<string, unknown>): QuestionsRequest | undefined {
	return undefined;
}

export function questionsResult(_input: Record<string, unknown>, _reply: QuestionsReply): PermissionResult | undefined {
	return undefined;
}
