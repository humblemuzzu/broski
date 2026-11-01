/** Text the CLI or an MCP server wrote, made safe to show: escape sequences and control characters removed. */

import { clip } from "../bounds";

const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\-_])/g;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** `text` without ANSI escapes and control characters (newlines and tabs stay), cut to `max`. */
export function plain(text: string, max: number): string {
	return clip(text.replace(ESCAPES, "").replace(CONTROLS, ""), max);
}
