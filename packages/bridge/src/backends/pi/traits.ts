/**
 * The capabilities Pi 1.4.0 declares. `fork`, `rename` and `delete` follow from the methods `backend.ts` implements;
 * `archive` is absent. Session capabilities: `controllable` and `compact` for a session this bridge made, neither for
 * one another client made (watch-only, README owner decisions); never `cancelQueued` (README, "the queue after Stop").
 */

import type { BackendTraits } from "../../contract";

export const PI_TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: true,
	promptModes: ["start", "steer", "queue"],
	attachments: ["image"],
	mentions: [],
	commands: true,
	queue: true,
	interactions: ["tool_permission", "choice", "confirm", "text"],
	modelSwitch: "next_request",
	thinking: true,
	children: false,
	usage: true,
	plan: false,
	planProposals: false,
	externalLive: false,
	durableRuns: false,
	extensions: [],
	backendOps: ["navigate_tree"],
};
