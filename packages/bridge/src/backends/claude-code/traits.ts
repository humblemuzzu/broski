/**
 * The capabilities Claude Code declares (D38); each is checked against the conformance rule that tests it (STEP-3 §4).
 * `fork`, `rename` and `delete` follow from the methods `backend.ts` implements; `archive` is absent (D16).
 */

import type { BackendTraits } from "../../contract";

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
	backendOps: [],
};
