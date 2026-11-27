/**
 * `status()`: whether the user's `agy` is there and its version, and whether it is signed in as the last catalog probe
 * found (`catalog/catalogs.ts`); status itself opens no session, so before any probe the sign-in is unknown. A probe
 * that failed for another reason may have failed for its directory alone, so it warns and leaves agy usable.
 */

import type { CliVersion } from "../../adapter-kit/cli-version";
import { phoneText } from "../../adapter-kit/phone-text";
import type { BackendStatus, StatusIssue } from "../../contract";
import type { SignIn } from "./catalog/catalogs";
import { AGY_SIGN_IN_FIX, type AgyCli } from "./install";

export interface StatusSources {
	readonly cli: AgyCli;
	readonly version: CliVersion | undefined;
	readonly signIn: () => SignIn;
}

function issue(severity: StatusIssue["severity"], message: string): StatusIssue {
	return { severity, message: phoneText(message) };
}

export async function antigravityStatus(sources: StatusSources): Promise<BackendStatus> {
	const { cli, version } = sources;
	if (!cli.found || version === undefined) {
		const reason = cli.found ? "Antigravity CLI was not found" : cli.reason;
		return { installed: false, auth: "unknown", usable: false, issues: [issue("error", reason)] };
	}
	const issues: StatusIssue[] = [];
	const read = await version.read();
	if ("problem" in read) issues.push(issue("warning", read.problem));
	const signIn = sources.signIn();
	if (signIn.kind === "signed_out") {
		issues.push(issue("error", `Antigravity is not signed in (agy said: ${signIn.text}). ${AGY_SIGN_IN_FIX}`));
	}
	if (signIn.kind === "failed") issues.push(issue("warning", `Antigravity could not open a session: ${signIn.text}`));
	const auth = signIn.kind === "signed_in" || signIn.kind === "signed_out" ? signIn.kind : "unknown";
	return {
		installed: true,
		...("version" in read && { version: read.version }),
		auth,
		usable: auth !== "signed_out",
		issues,
	};
}
