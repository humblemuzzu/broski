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
	commands: true,
	queue: true,
	interactions: ["tool_permission", "questions", "plan_approval", "form", "confirm"],
	thinking: true,
	children: true,
	usage: true,
	planProposals: false,
	externalLive: false,
	extensions: ["rate_limit"],
};
