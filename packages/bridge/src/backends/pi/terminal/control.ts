/**
 * What the phone may do to a session a terminal runs, through the terminal's own `pi` and no other writer: send a
 * message (start, steer or queue, as the terminal's session takes it) and stop the run. Stop is the terminal's Esc:
 * Pi's extension `ctx.abort()` is bound by the interactive mode to `restoreQueuedMessagesToEditor({ abort: true })`
 * (pi-coding-agent `src/modes/interactive/interactive-mode.ts:1978-1981`), so what was queued goes back into the
 * terminal's editor, not to the phone. Everything else is changed in the terminal.
 */

import type { ActionResult, ClientRequestId, PromptInput, PromptResult, SessionControl } from "../../../contract";
import { commandText, parseCommandId } from "../command-ids";
import { ACCEPTED, rejected } from "../rejections";
import type { CommandAnswer } from "./protocol";
import type { TerminalSession } from "./registry";

/** Accepted prompts remembered, as a hosted session remembers them (`PromptDesk`). */
const REMEMBERED_PROMPTS = 1_000;

const IN_THE_TERMINAL = "Change it in the terminal that runs this session.";

function refusal(answer: Extract<CommandAnswer, { ok: false }>) {
	return rejected(answer.code, answer.message);
}

function problem(input: PromptInput) {
	if (input.mentions.length > 0) return rejected("unsupported", "A terminal session takes no mentions.");
	if (input.attachments.some((attachment) => attachment.kind !== "image")) {
		return rejected("unsupported", "A terminal session takes images, not files.");
	}
	if (input.attachments.length === 0 && input.command === undefined && input.text.trim() === "") {
		return rejected("invalid_input", "the prompt is empty");
	}
	if (input.command !== undefined && parseCommandId(input.command) === undefined) {
		return rejected("not_found", `no command ${input.command}`);
	}
	return undefined;
}

export function terminalControl(session: TerminalSession): SessionControl {
	const accepted = new Map<ClientRequestId, PromptResult>();
	const remember = (id: ClientRequestId, result: PromptResult): void => {
		accepted.set(id, result);
		if (accepted.size > REMEMBERED_PROMPTS) {
			const oldest = accepted.keys().next();
			if (!oldest.done) accepted.delete(oldest.value);
		}
	};
	return {
		prompt: async (input) => {
			const known = accepted.get(input.clientRequestId);
			if (known) return known;
			const refused = problem(input);
			if (refused) return refused;
			const ref = input.command === undefined ? undefined : parseCommandId(input.command);
			const text = ref === undefined ? input.text : commandText(ref, input.text);
			session.feed.sent.add(input.clientRequestId, text, input.mode === "start");
			const answer = await session.command({
				kind: "prompt",
				mode: input.mode,
				text,
				expand: ref !== undefined,
				images: input.attachments.flatMap((attachment) =>
					attachment.kind === "image" ? [{ mimeType: attachment.mimeType, data: attachment.data }] : [],
				),
			});
			if (!answer.ok) {
				session.feed.sent.forget(input.clientRequestId);
				return refusal(answer);
			}
			const result: PromptResult = {
				status: "accepted",
				disposition: answer.disposition === "stopped" ? "handled" : answer.disposition,
			};
			remember(input.clientRequestId, result);
			return result;
		},
		abort: async (): Promise<ActionResult> => {
			const answer = await session.command({ kind: "abort" });
			return answer.ok ? ACCEPTED : refusal(answer);
		},
		answer: async () => rejected("not_found", "A question the terminal asks is answered in the terminal."),
		setModel: async () => rejected("unsupported", IN_THE_TERMINAL),
		setThinking: async () => rejected("unsupported", IN_THE_TERMINAL),
		setMode: async () => rejected("unsupported", IN_THE_TERMINAL),
	};
}
