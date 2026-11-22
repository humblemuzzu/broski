/** The running CLI's `claude_code_version` against the one the pinned SDK was released with (D3); a warning only. */

import type { StatusIssue } from "../../../contract";
import { clip } from "../bounds";

const MAX_VERSION_CHARS = 64;
const RELEASE = /^(\d+)\.(\d+)\.(\d+)/;

/** Absent on either side is no finding: a CLI that predates the field, or a build that did not bake one in. */
export function versionIssue(reported: string | undefined, expected: string | undefined): StatusIssue | undefined {
	if (reported === undefined || expected === undefined || reported === expected) return undefined;
	const made = clip(expected, MAX_VERSION_CHARS);
	const notify = atLeastVersion(reported, expected)
		? ""
		: ` Sessions started from the phone get broski_notify only from Claude Code ${made} on.`;
	return {
		severity: "warning",
		message: `Claude Code ${clip(reported, MAX_VERSION_CHARS)} is running, but this Broski build was made for ${made}; some features may not work until they match.${notify}`,
	};
}

/**
 * `reported` is `minimum` or a later release, by major, minor and patch. False when either is not a release number,
 * so a CLI whose version cannot be read is never taken for a new one.
 */
export function atLeastVersion(reported: string | undefined, minimum: string | undefined): boolean {
	const have = releaseOf(reported);
	const need = releaseOf(minimum);
	if (have === undefined || need === undefined) return false;
	const differs = have.findIndex((part, at) => part !== need[at]);
	return differs === -1 || (have[differs] ?? 0) > (need[differs] ?? 0);
}

function releaseOf(version: string | undefined): readonly number[] | undefined {
	const match = version === undefined ? null : RELEASE.exec(version.trim());
	return match === null ? undefined : match.slice(1, 4).map(Number);
}
