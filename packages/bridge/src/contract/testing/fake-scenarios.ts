import type { BackendTraits } from "../backend";
import type { InteractionKind, InteractionRequest } from "../interactions";
import type { Feature, Scenario } from "./conformance-types";
import type { FakeStep } from "./fake-script";

/** The steps that make a fake run play `scenario`, or undefined when the traits rule it out. */
export function scenarioSteps(traits: BackendTraits, scenario: Scenario): FakeStep[] | undefined {
	switch (scenario.kind) {
		case "reply":
			return [
				{ kind: "thinking", text: "Thinking it over." },
				{ kind: "text", text: "Here is the answer." },
			];
		case "tool":
			return [
				{
					kind: "tool",
					name: "read",
					input: { path: "notes.md" },
					output: "line one\nline two",
					streamInput: true,
					nested: [{ kind: "tool", name: "grep", input: { pattern: "one" }, output: "line one" }],
				},
				{ kind: "text", text: "Read it." },
			];
		case "hold":
			return [{ kind: "text", text: "Working." }, { kind: "hold" }, { kind: "text", text: "Done." }];
		case "interaction":
			return traits.interactions.includes(scenario.interaction) ? interactionSteps(scenario.interaction) : undefined;
		case "feature":
			return featureSteps(traits, scenario.feature);
		case "echo_model":
			return [{ kind: "echo_model" }, { kind: "hold" }, { kind: "echo_model" }];
		case "slow_retry":
			return [{ kind: "retry_wait" }, { kind: "text", text: "Recovered." }];
		case "slow_compaction":
			return undefined;
	}
}

function featureSteps(traits: BackendTraits, feature: Feature): FakeStep[] | undefined {
	switch (feature) {
		case "thinking":
			return traits.streamThinking
				? [
						{ kind: "thinking", text: "Let me think." },
						{ kind: "text", text: "Done." },
					]
				: undefined;
		case "usage":
			return traits.usage ? [{ kind: "usage", usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } }] : undefined;
		case "plan":
			return traits.plan ? [{ kind: "plan", plan: { items: [{ text: "Read", status: "completed" }] } }] : undefined;
		case "plan_proposal":
			return traits.planProposals ? [{ kind: "plan_proposal", text: "1. Read\n2. Write" }] : undefined;
		case "children":
			return traits.children
				? [{ kind: "tool", name: "task", input: {}, output: "delegated", child: true }]
				: undefined;
	}
}

function interactionSteps(kind: InteractionKind): FakeStep[] {
	if (kind === "tool_permission") {
		return [
			{ kind: "tool", name: "bash", input: { command: "rm -rf build" }, output: "removed", permission: true },
			{ kind: "text", text: "Cleaned." },
		];
	}
	return [
		{ kind: "ask", title: `A ${kind} question`, request: sampleRequest(kind) },
		{ kind: "text", text: "Thanks." },
	];
}

export function sampleRequest(kind: Exclude<InteractionKind, "tool_permission">): InteractionRequest {
	switch (kind) {
		case "questions":
			return {
				kind,
				questions: [
					{
						id: "q0",
						header: "Library",
						text: "Which library?",
						options: [{ label: "date-fns", description: "Small" }, { label: "luxon" }],
						multiSelect: false,
						allowCustom: true,
						secret: false,
						required: true,
					},
					{
						id: "q1",
						text: "Your token?",
						options: [],
						multiSelect: false,
						allowCustom: true,
						secret: true,
						required: false,
					},
				],
			};
		case "form":
			return {
				kind,
				server: "deploy",
				fields: [
					{
						kind: "string",
						key: "email",
						required: true,
						hidden: false,
						when: [],
						format: "email",
						options: [],
						allowCustom: false,
					},
					{ kind: "boolean", key: "notify", required: false, hidden: false, when: [], defaultValue: true },
					{
						kind: "multiselect",
						key: "channels",
						required: true,
						hidden: false,
						when: [{ key: "notify", op: "eq", value: { kind: "boolean", value: true } }],
						options: [
							{ value: "mail", label: "Mail" },
							{ value: "chat", label: "Chat" },
						],
						minItems: 1,
						allowCustom: false,
					},
					{ kind: "integer", key: "retries", required: false, hidden: false, when: [], minimum: 0, maximum: 5 },
				],
			};
		case "plan_approval":
			return { kind, plan: "# Plan\n1. Read\n2. Write", editable: true };
		case "external_url":
			return { kind, url: "https://example.com/authorize", server: "docs" };
		case "choice":
			return {
				kind,
				options: [
					{ value: "retry", label: "Retry" },
					{ value: "edit", label: "Edit the prompt" },
				],
			};
		case "confirm":
			return { kind };
		case "text":
			return { kind, placeholder: "Branch name", multiline: false };
	}
}
