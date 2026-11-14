/**
 * The message a person's "no" is sent with: the CLI's own wording for a rejected tool call (2.1.325 `claude` strings),
 * so the mapping reads the result as `denied`, live and in history (D18).
 */

import { HUMAN_DENIAL_PREFIX } from "../mapping/tool-outcome";

const REJECTED = `${HUMAN_DENIAL_PREFIX}proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).`;
const WAIT = "STOP what you are doing and wait for the user to tell you how to proceed.";

export function humanDenial(words: string | undefined): string {
	return words !== undefined && words.trim() !== ""
		? `${REJECTED} To tell you how to proceed, the user said:\n${words}`
		: `${REJECTED} ${WAIT}`;
}
