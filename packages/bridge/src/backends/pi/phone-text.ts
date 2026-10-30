/** Text Pi, an extension or a tool wrote, as the phone gets it: terminal escapes removed, then bounded. */

import { MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../contract";
import { clipStart } from "./bounds";
import { withoutTerminalEscapes } from "./terminal-text";

/** For a title, a label or a placeholder. */
export function phoneName(text: string): string {
	return clipStart(withoutTerminalEscapes(text), MAX_NAME_CHARS);
}

/** For a body, a prefilled text or a notice. */
export function phoneText(text: string): string {
	return clipStart(withoutTerminalEscapes(text), MAX_TEXT_CHARS);
}

/** A name or description from Pi's configuration or an extension, as one list row shows it. */
export function rowText(text: string | undefined): string {
	return phoneName(text ?? "").trim();
}
