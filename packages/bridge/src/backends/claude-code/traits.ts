/**
 * The capabilities Claude Code declares (D38); each is checked against the conformance rule that tests it (STEP-3 §4).
 * `fork`, `rename` and `delete` follow from the methods `backend.ts` implements; `archive` is absent (D16).
 */

import type { BackendOpKind, BackendTraits } from "../../contract";

const CUSTOM_TOOL_OPS: readonly BackendOpKind[] = ["custom_tools", "custom_tool"];

/** The custom tool ops (D30) only when the server layer provides the custom tools port. */
export function claudeCodeTraits(options: { readonly customTools: boolean }): BackendTraits {
	if (options.customTools) return CLAUDE_CODE_TRAITS;
	return {
		...CLAUDE_CODE_TRAITS,
		backendOps: CLAUDE_CODE_TRAITS.backendOps.filter((op) => !CUSTOM_TOOL_OPS.includes(op)),
	};
}

export const CLAUDE_CODE_TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: true,
	promptModes: ["start", "steer", "queue"],
	attachments: ["image"],
	mentions: ["file", "agent"],
	commands: true,
	queue: true,
	interactions: ["tool_permission", "questions", "plan_approval", "form", "external_url", "confirm"],
	modelSwitch: "next_request",
	thinking: true,
	children: true,
	usage: true,
	plan: false,
	planProposals: false,
	externalLive: false,
	durableRuns: false,
	extensions: ["rate_limit", "prompt_suggestion"],
	backendOps: [
		"rewind_files",
		"session_settings",
		"changed_files",
		"refresh_models",
		"config_files",
		"config_file",
		"settings_overview",
		"mcp_servers",
		"plugins",
		"tasks",
		"context_usage",
		"custom_tools",
		"custom_tool",
	],
};
