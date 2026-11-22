/** Why the CLI refused to start, in the phone's words: keyed by `startup_failure_reason`, never by the CLI's text. */

import {
	ORG_POLICY_LIMIT_PREFIXES,
	type SDKResultMessage,
	type SDKStartupFailureReason,
} from "@anthropic-ai/claude-agent-sdk";
import { MAX_PATH_CHARS, type RejectionCode } from "../../../contract";
import { phoneText } from "../phone-text";

interface StartupRefusal {
	readonly text: string;
	/** Signing in again (or an admin) is the fix, so the refusal is an `auth` one. */
	readonly signIn?: true;
}

/**
 * The SDK passes `--await-initialize` when a host's launch carries the bridge's MCP server (`mcpServersDelivery:
 * "initialize"`) and writes that request first, so `initialize_not_first` means a wrapper script read or changed it;
 * the bridge never passes `--managed-settings-in-initialize`, so `managed_settings_not_delivered` comes from a wrapper.
 */
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
	initialize_not_first: {
		text: "Claude Code did not get the bridge's start request first. If `claude` on this computer is a wrapper script, it must pass its input through unchanged.",
	},
	config_file_invalid: {
		text: "A Claude Code configuration file is not valid JSON, so Claude Code will not start. Run `claude` in a terminal on this computer to see which file and how to repair it.",
	},
	managed_settings_not_delivered: {
		text: "Claude Code was started expecting managed settings it did not get. If `claude` on this computer is a wrapper script, check the options it adds.",
	},
	initialize_fields_not_delivered: {
		text: "Claude Code was started expecting settings through initialize that did not match its flags. If `claude` on this computer is a wrapper script, check the options it adds.",
	},
};

/** Why the CLI would not start, and the file to repair when a configuration file does not parse. */
export interface StartupFailure {
	readonly reason: SDKStartupFailureReason;
	readonly configFile?: string;
}

/** What went wrong starting the CLI for a probe. */
export interface ProbeFailure {
	/** The SDK's or the CLI's own words; shown only when no known reason explains it. */
	readonly message: string;
	readonly startupFailure?: StartupFailure;
}

/** The refusal a result frame carries; undefined for every other result. */
export function startupFailureOf(result: SDKResultMessage): StartupFailure | undefined {
	if (result.subtype === "success" || result.startup_failure_reason === undefined) return undefined;
	const path = result.invalid_config_file?.path;
	return { reason: result.startup_failure_reason, ...(path !== undefined && { configFile: path }) };
}

/** The CLI's org-policy sentence, from where it starts: the SDK wraps an error result's text in its own words. */
function orgPolicyText(message: string): string | undefined {
	for (const prefix of ORG_POLICY_LIMIT_PREFIXES) {
		const at = message.indexOf(prefix);
		if (at >= 0) return message.slice(at);
	}
	return undefined;
}

/** A reason a newer CLI added is not in the table: frames may be newer than the types. */
function refusalOf(reason: SDKStartupFailureReason): StartupRefusal | undefined {
	return Object.hasOwn(REFUSALS, reason) ? REFUSALS[reason] : undefined;
}

export function refusalText(failure: StartupFailure): string {
	if (failure.reason === "config_file_invalid" && failure.configFile !== undefined) {
		const file = phoneText(failure.configFile, MAX_PATH_CHARS);
		return `Claude Code will not start: its configuration file ${file} is not valid JSON. Fix the JSON in that file, or move it aside to start with default settings.`;
	}
	return refusalOf(failure.reason)?.text ?? `Claude Code could not start (${failure.reason}).`;
}

export function refusalNeedsSignIn(reason: SDKStartupFailureReason): boolean {
	return refusalOf(reason)?.signIn === true;
}

export function failureText(failure: ProbeFailure): string {
	if (failure.startupFailure !== undefined) return refusalText(failure.startupFailure);
	return orgPolicyText(failure.message) ?? `Claude Code could not start: ${failure.message}`;
}

export function failureCode(failure: ProbeFailure): RejectionCode {
	return failure.startupFailure !== undefined && refusalNeedsSignIn(failure.startupFailure.reason)
		? "auth"
		: "backend_error";
}
