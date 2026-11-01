import { MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";

/** An error as a short line for a notice or a rejection. */
export function errorText(error: unknown): string {
	return clip(error instanceof Error ? error.message : String(error), MAX_TEXT_CHARS);
}
