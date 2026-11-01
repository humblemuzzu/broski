/** Lane C · D3: the running CLI's `claude_code_version` against the one this bridge was built with. */

import type { StatusIssue } from "../../../contract";
import { clip } from "../bounds";

const MAX_VERSION_CHARS = 64;

/** Absent on either side is no finding: a CLI that predates the field, or a build that did not bake one in. */
export function versionIssue(reported: string | undefined, expected: string | undefined): StatusIssue | undefined {
	if (reported === undefined || expected === undefined || reported === expected) return undefined;
	return {
		severity: "warning",
		message: `Claude Code ${clip(reported, MAX_VERSION_CHARS)} is running, but this Broski build was made for ${clip(expected, MAX_VERSION_CHARS)}; some features may not work until they match.`,
	};
}
