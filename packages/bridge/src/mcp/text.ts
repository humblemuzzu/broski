/**
 * Text an agent sent through a Broski tool, as the phone shows it: terminal escape sequences, C0/C1 controls (but
 * newline, tab and carriage return) and the invisible bidi direction characters of UAX #9 removed, then bounded.
 */

import { clip, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../contract";

const ESC = "\\u001B";
const OSC = `${ESC}\\][^\\u0007\\u001B\\u009C]*(?:\\u0007|${ESC}\\\\|\\u009C)`;
const CSI = `(?:${ESC}\\[|\\u009B)[0-?]*[ -/]*[@-~]`;
const OTHER = `${ESC}[ -/]*[0-~]`;
const ESCAPE_SEQUENCE = new RegExp(`${OSC}|${CSI}|${OTHER}`, "g");
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function shown(text: string): string {
	return text.replace(ESCAPE_SEQUENCE, "").replace(INVISIBLE, "");
}

export function phoneText(text: string, max: number = MAX_TEXT_CHARS): string {
	return clip(shown(text), max);
}

/** One line: no line breaks, trimmed. */
export function phoneLine(text: string, max: number = MAX_NAME_CHARS): string {
	return clip(shown(text).replace(/\s+/g, " ").trim(), max);
}
