import type { BackendMeta, BackendTraits } from "../backend";
import type { CommandSummary } from "../commands";
import type { ModelSummary } from "../models";
import type { ModeAxis } from "../modes";
import type { BackendStatus } from "../status";

export const FAKE_META: BackendMeta = { displayName: "Fake", accentHex: "#6E56CF", iconHint: "generic" };

export const FAKE_MODELS: readonly ModelSummary[] = [
	{
		id: "fake-large",
		displayName: "Fake Large",
		providerId: "fake",
		providerName: "Fake",
		contextWindow: 200_000,
		inputModalities: ["text", "image"],
		thinking: {
			options: [{ value: "low" }, { value: "medium" }, { value: "high", label: "High", description: "Thinks longest" }],
			defaultValue: "medium",
		},
		isDefault: true,
	},
	{
		id: "fake-small",
		displayName: "Fake Small",
		providerId: "fake",
		thinking: { options: [] },
		isDefault: false,
	},
];

/** `/noop` is consumed by the backend without a run. */
export const FAKE_COMMANDS: readonly CommandSummary[] = [
	{ id: "/review", name: "review", kind: "command", description: "Review the changes", argumentHint: "[path]" },
	{ id: "/noop", name: "noop", kind: "command" },
	{ id: "skill:tidy", name: "tidy", kind: "skill" },
];

export const FAKE_MODES: readonly ModeAxis[] = [
	{
		id: "permissions",
		label: "Permissions",
		options: [
			{ value: "ask", label: "Ask first" },
			{ value: "edits", label: "Accept edits", description: "File edits run without asking." },
			{ value: "all", label: "Allow everything", description: "Nothing asks first, commands included." },
		],
		defaultValue: "ask",
	},
	{
		id: "agent",
		label: "Agent",
		options: [
			{ value: "build", label: "Build" },
			{ value: "plan", label: "Plan", description: "Reads and plans; changes nothing." },
		],
	},
];

export const FAKE_STATUS: BackendStatus = {
	installed: true,
	version: "0.0.0-fake",
	auth: "signed_in",
	usable: true,
	issues: [],
};

/** Everything the fake can do. */
export const FULL_TRAITS: BackendTraits = {
	streamText: true,
	streamThinking: true,
	promptModes: ["start", "steer", "queue"],
	attachments: ["image", "file"],
	commands: true,
	queue: true,
	interactions: ["tool_permission", "questions", "form", "plan_approval", "choice", "confirm", "text"],
	thinking: true,
	children: true,
	usage: true,
	planProposals: true,
	externalLive: true,
	extensions: ["rate_limit"],
};

/** A backend with nothing optional: whole blocks, no queue view, no interactions, start-only prompts. */
export const MINIMAL_TRAITS: BackendTraits = {
	streamText: false,
	streamThinking: false,
	promptModes: ["start"],
	attachments: [],
	commands: false,
	queue: false,
	interactions: [],
	thinking: false,
	children: false,
	usage: false,
	planProposals: false,
	externalLive: false,
	extensions: [],
};
