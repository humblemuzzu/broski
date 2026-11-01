import { MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { SessionEmitter } from "../ports/live";
import { errorText } from "./error-text";

/** A step of ending a run that another lane's part fails must not stop the ones after it: the failure is a notice. */
export function attempt(live: SessionEmitter, what: string, work: () => void): void {
	try {
		work();
	} catch (error) {
		live.emit({ type: "notice", level: "error", text: clip(`${what} failed: ${errorText(error)}`, MAX_TEXT_CHARS) });
	}
}
