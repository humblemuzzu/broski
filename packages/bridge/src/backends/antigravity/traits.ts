/**
 * The capabilities Antigravity CLI 1.5.18 declares over `agy acp`. It has no fork, rename or delete (each answers
 * `Method not found`), so the backend implements none: the core's portable fork stands in for fork. `steer` and `queue`
 * come from the core, since a second `session/prompt` mid-turn takes over the first turn's output. Session
 * capabilities: `controllable` and `compact` while the bridge holds the conversation's presence lock, neither while a
 * terminal `agy` holds it (watch-only, since `agy` has no channel for a terminal's asks).
 */

import type { BackendMeta, BackendTraits } from "../../contract";

export const ANTIGRAVITY_META: BackendMeta = {
	displayName: "Antigravity",
	accentHex: "#1A73E8",
	iconHint: "antigravity",
};

export const ANTIGRAVITY_TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: true,
	promptModes: ["start"],
	attachments: ["image"],
	commands: true,
	queue: false,
	interactions: ["tool_permission", "questions"],
	thinking: true,
	children: false,
	usage: true,
	planProposals: false,
	externalLive: false,
	extensions: [],
};
