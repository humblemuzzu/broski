import { rejected } from "../../adapter-kit/rejections";
import { MAX_NAME_CHARS, type Rejected } from "../../contract";

/**
 * A rename's title as Pi stores it (`appendSessionInfo`, pi-coding-agent `src/core/session-manager.ts:1304-1315`:
 * line breaks become spaces, then trimmed), refused when that leaves nothing or too much. Pi itself takes an empty
 * name as clearing the title; the contract's rename names a session, so it is refused, hosted or not.
 */
export function sessionName(title: string): string | Rejected {
	const name = title.replace(/[\r\n]+/g, " ").trim();
	if (name.length === 0) return rejected("invalid_input", "a session name cannot be empty");
	if (name.length > MAX_NAME_CHARS) {
		return rejected("invalid_input", `a session name holds at most ${MAX_NAME_CHARS} characters`);
	}
	return name;
}
