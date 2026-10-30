/**
 * `backend.call` `system_prompt` (contract README §13): the session's current system prompt, `session.systemPrompt`
 * (pi `dist/core/agent-session.js:1076`: the prompt the next request carries, tool changes included), in pages a phone
 * can hold. The page says where it ends and where the next begins, so a prompt is never cut without saying so.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { BackendCallResult, SystemPromptOp } from "../../../contract";
import { clipStart } from "../bounds";

export const SYSTEM_PROMPT_PAGE_CHARS = 32_768;

export function systemPrompt(session: AgentSession, op: SystemPromptOp): BackendCallResult {
	const prompt = session.systemPrompt;
	const offset = Math.min(op.offset ?? 0, prompt.length);
	const text = clipStart(prompt.slice(offset, offset + SYSTEM_PROMPT_PAGE_CHARS + 1), SYSTEM_PROMPT_PAGE_CHARS);
	const next = offset + text.length;
	return {
		status: "accepted",
		result: {
			kind: "system_prompt",
			text,
			offset,
			totalChars: prompt.length,
			...(next < prompt.length && { nextOffset: next }),
		},
	};
}
