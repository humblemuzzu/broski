/**
 * Text written for a terminal, as a phone shows it: without escape sequences. Extensions style their
 * dialog and notice text with `ctx.ui.theme`, which emits SGR codes even from `plainTheme()`, and
 * tools print colour; Pi's own renderer strips both (pi-coding-agent `src/core/tools/render-utils.ts:67`).
 */

const ESC = "\\u001B";
/** The body stops at the first BEL, ESC or ST, so an unterminated command costs one scan, not one per start. */
const OSC = `${ESC}\\][^\\u0007\\u001B\\u009C]*(?:\\u0007|${ESC}\\\\|\\u009C)`;
const CSI = `(?:${ESC}\\[|\\u009B)[0-?]*[ -/]*[@-~]`;
const OTHER = `${ESC}[ -/]*[0-~]`;
const ESCAPE_SEQUENCE = new RegExp(`${OSC}|${CSI}|${OTHER}`, "g");

/** ECMA-48 control sequences (CSI), operating system commands (OSC) and two-character escapes removed. */
export function withoutTerminalEscapes(text: string): string {
	return text.includes("\u001B") || text.includes("\u009B") ? text.replace(ESCAPE_SEQUENCE, "") : text;
}
