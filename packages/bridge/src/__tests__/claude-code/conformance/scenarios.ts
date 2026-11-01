/**
 * Each conformance `Scenario` as the model's side of the run, per 08-spike: Write in `default` mode asks
 * `tool_permission`; AskUserQuestion asks `questions`; plan mode's Write-then-ExitPlanMode asks `plan_approval`; the
 * elicitation server's tools ask `form`, `external_url` and `confirm`; an Agent call shows a child session.
 */

import type { InteractionKind } from "../../../contract";
import type { Feature, Scenario } from "../../../contract/testing/conformance-types";
import type { ScriptedRequest, ScriptedTurn } from "../../helpers/scripted-anthropic-server";
import { planPathIn } from "../spike/rig/plan-script";
import { type ElicitTool, elicitToolName } from "./elicit-server";
import type { ScriptStep } from "./session-router";

export interface ScenarioContext {
	readonly cwd: string;
	/** Settles at the session's next `release`. */
	readonly gate: () => Promise<void>;
	/** The listed model id a request ran with, for `echo_model`. */
	readonly echo: (request: ScriptedRequest) => string;
}

const ANSWER: ScriptedTurn = { text: ["Done."] };

/** The steps of `scenario`, or undefined when this driver cannot produce it (STEP-3 §10). */
export function scenarioSteps(scenario: Scenario, context: ScenarioContext): ScriptStep[] | undefined {
	switch (scenario.kind) {
		case "reply":
			return [{ text: ["Hello ", "from ", "the ", "script."] }];
		case "tool":
			return [readReadme(context), { text: ["The README names the magic word."] }];
		case "hold":
			return [{ text: ["Held answer."], gate: context.gate() }];
		case "interaction":
			return interactionSteps(scenario.interaction);
		case "feature":
			return featureSteps(scenario.feature);
		case "echo_model":
			return [
				(request) => ({ ...readReadme(context), text: [context.echo(request)] }),
				(request) => ({ text: [context.echo(request)], gate: context.gate() }),
			];
		case "slow_compaction":
		case "slow_retry":
			return undefined;
	}
}

function readReadme(context: ScenarioContext): ScriptedTurn {
	return { toolCalls: [{ name: "Read", args: { file_path: `${context.cwd}/README.md` } }] };
}

function interactionSteps(kind: InteractionKind): ScriptStep[] | undefined {
	switch (kind) {
		case "tool_permission":
			return [{ toolCalls: [{ name: "Write", args: { file_path: "conformance.txt", content: "hi\n" } }] }, ANSWER];
		case "questions":
			return [{ toolCalls: [{ name: "AskUserQuestion", args: { questions: [QUESTION] } }] }, ANSWER];
		case "plan_approval":
			return [writePlan, { toolCalls: [{ name: "ExitPlanMode", args: {} }] }, ANSWER];
		case "form":
			return elicit("ask_form");
		case "external_url":
			return elicit("ask_url");
		case "confirm":
			return elicit("ask_confirm");
		case "choice":
		case "text":
			return undefined;
	}
}

const QUESTION = {
	question: "Which color?",
	header: "Color",
	multiSelect: false,
	options: [
		{ label: "Red", description: "warm" },
		{ label: "Blue", description: "cool" },
	],
};

/** The plan file the plan-mode reminder names (CLI 2.1.316 reads the plan from it, Q6). */
function writePlan(request: ScriptedRequest): ScriptedTurn {
	const path = planPathIn(request.body) ?? "plan.md";
	return { toolCalls: [{ name: "Write", args: { file_path: path, content: "# Plan\n\n1. Do it.\n" } }] };
}

function elicit(tool: ElicitTool): ScriptStep[] {
	return [{ toolCalls: [{ name: elicitToolName(tool), args: {} }] }, ANSWER];
}

function featureSteps(feature: Feature): ScriptStep[] | undefined {
	switch (feature) {
		case "thinking":
			return [{ thinking: ["Let ", "me ", "think."], text: ["Thought it through."] }];
		case "usage":
			return [{ text: ["Counted."] }];
		case "children":
			return [{ toolCalls: [{ name: "Agent", args: AGENT_CALL }] }, { text: ["The subagent finished."] }];
		case "plan":
		case "plan_proposal":
			return undefined;
	}
}

const AGENT_CALL = {
	description: "Find the word",
	prompt: "Read README.md",
	subagent_type: "general-purpose",
	run_in_background: false,
};
