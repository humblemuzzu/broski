/**
 * The capabilities Pi 1.4.0 declares. `fork`, `rename` and `delete` follow from the methods `backend.ts` implements.
 * `externalLive`: a terminal `pi` that runs the Broski link extension is followed live. Session capabilities:
 * `controllable` and `compact` for a session this bridge runs, `controllable` alone for one a terminal runs
 * (a message and Stop go through that terminal), neither for one another client made (watch-only); never `cancelQueued`.
 */

import type { BackendTraits } from "../../contract";

export const PI_TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: true,
	promptModes: ["start", "steer", "queue"],
	attachments: ["image"],
	commands: true,
	queue: true,
	interactions: ["tool_permission", "questions", "choice", "confirm", "text"],
	thinking: true,
	children: true,
	usage: true,
	planProposals: false,
	externalLive: true,
	extensions: [],
};
