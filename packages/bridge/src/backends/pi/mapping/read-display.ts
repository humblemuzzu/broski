/**
 * Pi's built-in `read` as file text: the lines it returned from `offset` (1-based, as the tool takes it), without the
 * note it appends for the model (`[Showing lines 1-2000 of 4512. Use offset=2001 to continue.]`, `[12 more lines in
 * file. Use offset=40 to continue.]`), which becomes the display's note in the person's words. A read that returned an
 * image, or only a message about a line too long to show (`[Line 1 is 80KB, …]`), has no lines to show
 * (`@earendil-works/pi-coding-agent` `dist/core/tools/read.js`).
 */

import { MAX_PATH_CHARS, type ToolContent, type ToolDisplay } from "../../../contract";
import { isRecord } from "../json";

const NOTE =
	/\n\n\[((?:Showing lines \d+-\d+ of \d+)(?: \([^)\]]*\))?|\d+ more lines? in file)\. Use offset=\d+ to continue\.\]$/;
const TOO_LONG = /^\[Line \d+ is .+, exceeds .+ limit\. Use bash: /;

export interface ToolCallFacts {
	readonly name: string;
	readonly input: unknown;
}

export function readDisplay(call: ToolCallFacts | undefined, parts: readonly ToolContent[]): ToolDisplay | undefined {
	if (call?.name !== "read" || !isRecord(call.input) || parts.length !== 1) return undefined;
	const [part] = parts;
	const path = call.input.path;
	if (part?.kind !== "text" || typeof path !== "string" || path === "" || path.length > MAX_PATH_CHARS)
		return undefined;
	if (TOO_LONG.test(part.text)) return undefined;
	const offset = call.input.offset;
	const firstLine = typeof offset === "number" && Number.isSafeInteger(offset) && offset > 1 ? offset : 1;
	const note = NOTE.exec(part.text);
	const text = note === null ? part.text : part.text.slice(0, note.index);
	return { kind: "file_text", path, firstLine, text, ...(note?.[1] !== undefined && { note: note[1] }) };
}
