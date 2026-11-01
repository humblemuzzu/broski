/** Lane B · why an `is_error` tool result failed: the CLI's own wording says whether a call was cut short or refused. */

import type { ToolOutcome } from "../../../contract";

/** The CLI cut a running call short (2.1.316 `claude` strings: "this call was stopped while running, not refused before it ran"). */
const STOPPED_WHILE_RUNNING = "this call was stopped while running";
const INTERRUPT_NOTICE = "[Request interrupted by user";

/**
 * How the CLI's own text for a person's "no" begins. A denial this adapter sends through `canUseTool` reads as `denied`
 * when its message starts with it (the CLI hands that message back as the tool result, verbatim: `fixture:permission-deny`).
 */
export const HUMAN_DENIAL_PREFIX = "The user doesn't want to ";

/** Its canned refusals: a person's "no" in its own prompt, a permission rule, and a mode that cannot ask. */
const REFUSAL_PREFIXES: readonly string[] = [HUMAN_DENIAL_PREFIX, "Permission to use ", "Permission for this "];

/**
 * The outcome of a result the CLI marked `is_error`. A call a person refused through `canUseTool` carries the
 * message that was sent as the denial, which only reads as `denied` when it starts like the CLI's own.
 */
export function failureOutcome(text: string): Exclude<ToolOutcome, "completed"> {
	if (text.includes(STOPPED_WHILE_RUNNING) || text.startsWith(INTERRUPT_NOTICE)) return "aborted";
	return REFUSAL_PREFIXES.some((prefix) => text.startsWith(prefix)) ? "denied" : "failed";
}
