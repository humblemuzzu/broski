/**
 * Text a tool, a hook, an MCP server or the CLI wrote, as the phone shows it: terminal escape sequences, C0/C1
 * controls (but newline, tab and carriage return) and the invisible bidi direction characters removed, then bounded.
 * A person decides allow or deny on this text, so what it shows must be what is there, in its order.
 */

import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../contract";
import { clip } from "./bounds";

const ESC = "\\u001B";
const OSC = `${ESC}\\][^\\u0007\\u001B\\u009C]*(?:\\u0007|${ESC}\\\\|\\u009C)`;
const CSI = `(?:${ESC}\\[|\\u009B)[0-?]*[ -/]*[@-~]`;
const OTHER = `${ESC}[ -/]*[0-~]`;
const ESCAPE_SEQUENCE = new RegExp(`${OSC}|${CSI}|${OTHER}`, "g");
/** C0 but \t \n \r, DEL, C1, and the marks, embeddings, overrides and isolates of UAX #9 (U+061C, 200E-F, 202A-E, 2066-9). */
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** ECMA-48 control sequences (CSI), operating system commands (OSC) and two-character escapes removed. */
export function withoutTerminalEscapes(text: string): string {
	return text.includes("\u001B") || text.includes("\u009B") ? text.replace(ESCAPE_SEQUENCE, "") : text;
}

export function shownText(text: string): string {
	return withoutTerminalEscapes(text).replace(INVISIBLE, "");
}

/** For a body: a tool's output, a notice, a message, an ask's text. */
export function phoneText(text: string, max: number = MAX_TEXT_CHARS): string {
	return clip(shownText(text), max);
}

/** For a one-line label (a title, a window name): no line breaks, bounded to `max` units. */
export function phoneLine(text: string, max: number = MAX_NAME_CHARS): string {
	return clip(shownText(text).replace(/\s+/g, " ").trim(), max);
}
