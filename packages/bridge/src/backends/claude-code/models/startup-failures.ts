/** Why the CLI refused to start, in the phone's words: keyed by `startup_failure_reason` (`d.ts:6213`), never by the CLI's text. */

import { ORG_POLICY_LIMIT_PREFIXES, type SDKStartupFailureReason } from "@anthropic-ai/claude-agent-sdk";
import type { RejectionCode } from "../../../contract";

interface StartupRefusal {
	readonly text: string;
	/** Signing in again (or an admin) is the fix, so the refusal is an `auth` one. */
	readonly signIn?: true;
}

const REFUSALS: { readonly [R in SDKStartupFailureReason]: StartupRefusal } = {
	org_pin_api_key_conflict: {
		text: "Your organization requires a Claude sign-in, but an Anthropic API key or auth token is configured instead.",
	},
	provider_not_allowed: {
		text: "Your organization's policy does not allow the API provider Claude Code is set up for.",
	},
	org_verify_failed: {
		text: "Claude Code could not verify your organization's sign-in: a network problem, or the sign-in was revoked.",
	},
	org_pin_mismatch: {
		text: "You are signed in to an organization your policy does not allow.",
		signIn: true,
	},
	managed_settings_invalid: {
		text: "Your organization's managed settings could not be read, or they block every model Claude Code could use.",
	},
	remote_settings_required_unavailable: {
		text: "Settings your organization requires could not be loaded.",
	},
	gateway_signin_required: {
		text: "The gateway ended your sign-in. Sign in again.",
		signIn: true,
	},
	gateway_access_denied: {
		text: "The gateway refused managed settings for this account.",
	},
	proxy_invalid: {
		text: "A proxy setting (HTTPS_PROXY, HTTP_PROXY or similar) is not a complete URL.",
	},
	temp_dir_unusable: {
		text: "Claude Code's temporary directory is unsafe or could not be created.",
	},
	cwd_unavailable: {
		text: "The working folder was deleted, moved or cannot be read.",
	},
	shell_tool_missing: { text: "No shell tool is available on this machine." },
	session_held_by_background: {
		text: "That conversation is running as a background session.",
	},
	worktree_resume_refused: {
		text: "The session's worktree failed its safety checks.",
	},
	worktree_unverified: {
		text: "The session's worktree could not be verified right now. Try again.",
	},
	cli_version_too_old: {
		text: "This Claude Code version is older than the minimum Anthropic requires. Update it.",
	},
	bypass_root: { text: "Bypass permissions mode cannot run as root." },
	org_config_required_unavailable: {
		text: "Your organization requires its policy and settings before a session starts, and they could not be loaded. Try again.",
	},
	org_config_refused: {
		text: "Anthropic refused your organization's policy and settings for this sign-in. Sign in again, or ask your admin.",
		signIn: true,
	},
	sandbox_required_unavailable: {
		text: "A sandbox is required but cannot run here, for example because bubblewrap is missing.",
	},
};

/** What went wrong starting the CLI for a probe. */
export interface ProbeFailure {
	/** The SDK's or the CLI's own words; shown only when no known reason explains it. */
	readonly message: string;
	readonly startupFailure?: SDKStartupFailureReason;
}

/** The CLI's org-policy sentence, from where it starts: the SDK wraps an error result's text in its own words. */
function orgPolicyText(message: string): string | undefined {
	for (const prefix of ORG_POLICY_LIMIT_PREFIXES) {
		const at = message.indexOf(prefix);
		if (at >= 0) return message.slice(at);
	}
	return undefined;
}

export function refusalText(reason: SDKStartupFailureReason): string {
	return REFUSALS[reason].text;
}

export function refusalNeedsSignIn(reason: SDKStartupFailureReason): boolean {
	return REFUSALS[reason].signIn === true;
}

export function failureText(failure: ProbeFailure): string {
	if (failure.startupFailure !== undefined) return refusalText(failure.startupFailure);
	return orgPolicyText(failure.message) ?? `Claude Code could not start: ${failure.message}`;
}

export function failureCode(failure: ProbeFailure): RejectionCode {
	return failure.startupFailure !== undefined && refusalNeedsSignIn(failure.startupFailure) ? "auth" : "backend_error";
}
