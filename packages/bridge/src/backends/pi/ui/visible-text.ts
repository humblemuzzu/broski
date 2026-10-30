/**
 * Text a human approves as it will run: control characters and the Unicode direction controls are written out as
 * `\u{…}`, so a command cannot hide part of itself behind a carriage return, an escape sequence or a right-to-left
 * override. Tabs and line feeds stay as they are.
 */
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function visibleText(text: string): string {
	return text.replace(HIDDEN, (char) => `\\u{${char.charCodeAt(0).toString(16).toUpperCase()}}`);
}
