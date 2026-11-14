/**
 * The capabilities Pi 1.4.0 declares. `fork`, `rename` and `delete` follow from the methods `backend.ts` implements;
 * `archive` is absent. `externalLive`: a terminal `pi` that runs the Broski link extension is followed live. Session
 * capabilities: `controllable`, `compact`, `cancelCompaction` and `cancelRetry` for a session this bridge runs, `controllable` alone for one a terminal runs
 * (a message and Stop go through that terminal), neither for one nobody runs here (watch-only, until it is taken over);
 * never `cancelQueued`.
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
	children: true,
	usage: true,
	plan: false,
	planProposals: false,
	externalLive: true,
	durableRuns: false,
	extensions: [],
	backendOps: [],
};
