/** `status()` (D7): binary found, version, auth, policy refusals; never fails (contract `BackendStatus`). */

import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import { type BackendStatus, MAX_NAME_CHARS, MAX_TEXT_CHARS, type StatusIssue } from "../../contract";
import { clip } from "./bounds";
import { authOf } from "./models/account-state";
import { failureText, type ProbeFailure } from "./models/startup-failures";
import { versionIssue } from "./process/version-check";

/** What a status is made from: nothing to run, an `initialize` answer, or the CLI's refusal to give one. */
export type StatusSource =
	| { readonly kind: "missing"; readonly reason: string }
	| { readonly kind: "answered"; readonly init: SDKControlInitializeResponse }
	| { readonly kind: "refused"; readonly failure: ProbeFailure }
	| { readonly kind: "unreadable"; readonly installed: boolean; readonly reason: string };

const SIGNED_OUT: StatusIssue = {
	severity: "error",
	message: "Claude Code is not signed in. Run `claude` in a terminal on this computer and sign in, then try again.",
};

function error(message: string): StatusIssue {
	return { severity: "error", message: clip(message, MAX_TEXT_CHARS) };
}

function answered(init: SDKControlInitializeResponse, expectedCliVersion: string | undefined): BackendStatus {
	const auth = authOf(init.account);
	const mismatch = versionIssue(init.claude_code_version, expectedCliVersion);
	const issues = [...(auth === "signed_out" ? [SIGNED_OUT] : []), ...(mismatch ? [mismatch] : [])];
	return {
		installed: true,
		...(init.claude_code_version !== undefined && {
			version: clip(init.claude_code_version, MAX_NAME_CHARS),
		}),
		auth,
		usable: auth !== "signed_out",
		issues,
	};
}

export function claudeCodeStatus(source: StatusSource, expectedCliVersion: string | undefined): BackendStatus {
	switch (source.kind) {
		case "missing":
			return {
				installed: false,
				auth: "unknown",
				usable: false,
				issues: [error(`Claude Code was not found: ${source.reason}`)],
			};
		case "refused":
			return {
				installed: true,
				auth: "unknown",
				usable: false,
				issues: [error(failureText(source.failure))],
			};
		case "unreadable":
			return {
				installed: source.installed,
				auth: "unknown",
				usable: false,
				issues: [error(`Claude Code's state could not be found out: ${source.reason}`)],
			};
		case "answered":
			return answered(source.init, expectedCliVersion);
	}
}
