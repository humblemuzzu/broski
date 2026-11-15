/**
 * `status()`: whether the user's `pi` is there, its version, and whether a session would have a model to run, read from
 * the catalog of the agent dir (`catalog/`). Pi counts a model available only when its provider is signed in, so no
 * model at all is "signed out". Finding out never fails: whatever stops it is an `error` issue (contract README §11.4).
 */

import { type BackendStatus, MAX_LIST_ITEMS, MAX_TEXT_CHARS, type StatusIssue } from "../../contract";
import { clipStart } from "./bounds";
import type { PiCatalogs } from "./catalog/catalogs";
import { type CliVersion, compareVersions, MIN_PI_VERSION } from "./cli-version";
import { PI_UPDATE_FIX, type PiCli } from "./pi-install";

export interface StatusSources {
	readonly cli: PiCli;
	readonly version: CliVersion | undefined;
	readonly catalogs: PiCatalogs;
	/** Why the terminal link does not work, when it does not. */
	readonly linkProblem: () => string | undefined;
}

function issue(severity: StatusIssue["severity"], message: string): StatusIssue {
	return { severity, message: clipStart(message, MAX_TEXT_CHARS) };
}

const NOT_INSTALLED = (reason: string): BackendStatus => ({
	installed: false,
	auth: "unknown",
	usable: false,
	issues: [issue("error", reason)],
});

export async function piStatus(sources: StatusSources): Promise<BackendStatus> {
	const { cli, version } = sources;
	if (!cli.found || version === undefined) return NOT_INSTALLED(cli.found ? "Pi was not found" : cli.reason);
	const issues: StatusIssue[] = [];
	const read = await version.read();
	if ("problem" in read) issues.push(issue("warning", read.problem));
	else if (compareVersions(read.version, MIN_PI_VERSION) < 0) {
		issues.push(
			issue(
				"warning",
				`Pi ${read.version} is older than ${MIN_PI_VERSION}, the oldest Pi this bridge runs as intended. ${PI_UPDATE_FIX}`,
			),
		);
	}
	const catalog = await sources.catalogs.read(undefined);
	const usable = !("failure" in catalog) && catalog.models.length > 0;
	if ("failure" in catalog) issues.push(issue("error", `Pi could not start: ${catalog.failure}`));
	else if (!usable) {
		issues.push(issue("error", "No model is available. Run `pi` and use /login, or set a provider's API key."));
	}
	const linkProblem = sources.linkProblem();
	if (linkProblem !== undefined) issues.push(issue("warning", linkProblem));
	return {
		installed: true,
		...("version" in read && { version: read.version }),
		auth: "failure" in catalog ? "unknown" : usable ? "signed_in" : "signed_out",
		usable,
		issues: issues.slice(0, MAX_LIST_ITEMS),
	};
}
