/**
 * An extension's message (`pi.sendMessage({ customType, content, display, details })`) as an activity. An extension
 * that wants a card of its own says what it shows in `details.broski`, in the contract's own `Activity` shape
 * (`docs/architecture/backends/pi/extension-hints.md`). Any other message reads as Pi's terminal shows one with no
 * renderer: its `customType` over its text (pi-coding-agent 1.5.2 `dist/modes/interactive/components/custom-message.js:72-93`).
 */

import { isRecord } from "../../../adapter-kit/bounded-json";
import { withoutTerminalEscapes } from "../../../adapter-kit/phone-text";
import { type Activity, Activity as ActivitySchema } from "../../../contract";
import { clipEnd } from "../bounds";
import { contentText, type UserContent } from "../messages";
import { phoneName, phoneText } from "../phone-text";

export const HINT_KEY = "broski";
/** A log keeps its newest part: the phone shows its last lines. */
const LOG_CHARS = 64 * 1024;
/** A hint names no session: an extension knows none of the bridge's. */
const Hint = ActivitySchema.omit({ childSession: true });

/** Undefined for a message there is nothing to show of. */
export function customActivity(customType: unknown, content: UserContent, details: unknown): Activity | undefined {
	const hinted = hintOf(details);
	if (hinted !== undefined) return hinted;
	const text = phoneText(contentText(content)).trim();
	if (text === "") return undefined;
	return { kind: "message", title: typeTitle(customType), body: { format: "markdown", text } };
}

/** `bash-job` reads "Bash job". */
function typeTitle(customType: unknown): string {
	const words =
		typeof customType === "string"
			? phoneName(customType)
					.replace(/[\s\-_.:/]+/g, " ")
					.trim()
			: "";
	return words === "" ? "Extension message" : words.charAt(0).toUpperCase() + words.slice(1);
}

/** The hint's known fields, bounded, as one `Activity`; a hint that is not one is no hint, and the message reads plainly. */
function hintOf(details: unknown): Activity | undefined {
	const hint = isRecord(details) ? details[HINT_KEY] : undefined;
	if (!isRecord(hint)) return undefined;
	const { kind, title, status, command, durationMs, exitCode, body } = hint;
	const shown = isRecord(body) ? shownBody(body) : undefined;
	const parsed = Hint.safeParse({
		kind,
		title: typeof title === "string" ? phoneName(title).replace(/\s+/g, " ").trim() : title,
		...(status !== undefined && { status }),
		...(typeof command === "string" && command !== "" && { command: phoneText(command) }),
		...(typeof durationMs === "number" && { durationMs: Math.round(durationMs) }),
		...(exitCode !== undefined && { exitCode }),
		...(shown !== undefined && { body: shown }),
	});
	return parsed.success ? parsed.data : undefined;
}

/** Undefined for a body with nothing in it. */
function shownBody(body: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
	const { format, text } = body;
	if (typeof text !== "string") return { format, text };
	const shown = format === "log" ? clipEnd(withoutTerminalEscapes(text), LOG_CHARS) : phoneText(text);
	return shown.trim() === "" ? undefined : { format, text: shown };
}
