/** Text a tool, a hook or the CLI wrote for a terminal, as the phone gets it: escape sequences removed, then bounded. */

import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";

const ESC = "\\u001B";
const OSC = `${ESC}\\][^\\u0007\\u001B\\u009C]*(?:\\u0007|${ESC}\\\\|\\u009C)`;
const CSI = `(?:${ESC}\\[|\\u009B)[0-?]*[ -/]*[@-~]`;
const OTHER = `${ESC}[ -/]*[0-~]`;
const ESCAPE_SEQUENCE = new RegExp(`${OSC}|${CSI}|${OTHER}`, "g");

/** ECMA-48 control sequences (CSI), operating system commands (OSC) and two-character escapes removed. */
export function withoutTerminalEscapes(text: string): string {
	return text.includes("\u001B") || text.includes("\u009B") ? text.replace(ESCAPE_SEQUENCE, "") : text;
}

/** For a body: a tool's output, a notice, a message. */
export function phoneText(text: string): string {
	return clip(withoutTerminalEscapes(text), MAX_TEXT_CHARS);
}

/** For a one-line label (a title, a window name): no line breaks, bounded to `max` units. */
export function phoneLine(text: string, max: number = MAX_NAME_CHARS): string {
	return clip(withoutTerminalEscapes(text).replace(/\s+/g, " ").trim(), max);
}
