/**
 * The scripted model's turns for each conformance `Scenario`, as Pi can play them. A scenario Pi lacks (plan
 * proposals, questions, forms, plans) has no script: the driver answers `false`.
 */

import type { Scenario } from "../../../contract/testing/conformance-types";
import type { ScriptedRequest, ScriptedTurn } from "../../helpers/scripted-openai-server";
import type { PiRouter, ScriptStep } from "./pi-router";

export const REPLY_TEXT = "Here is the answer.";
export const PROVIDER = "scripted";

export function say(text: string): ScriptedTurn {
	return { text: [text] };
}

/** One response that calls a tool and so continues the run. */
export function call(
	name: string,
	args: Record<string, unknown>,
	before: Omit<ScriptedTurn, "toolCalls"> = {},
): ScriptedTurn {
	return { ...before, toolCalls: [{ name, args }] };
}

export function readReadme(): ScriptedTurn {
	return call("read", { path: "README.md" });
}

/** A call of the driver's dialog tool; its answer is noted under `tag`, the title when none is given. */
export function askHuman(
	dialog: "select" | "confirm" | "input" | "editor",
	title: string,
	extra: { tag?: string; options?: string[]; timeoutMs?: number; withSignal?: boolean; abortAfterMs?: number } = {},
): ScriptedTurn {
	return { toolCalls: [{ name: "ask_human", args: { tag: title, dialog, title, ...extra } }] };
}

/** A call of the driver's subagent tool; with a gate, the tool parks after its first update. */
export function subagent(task: string, gate?: string): ScriptedTurn {
	return { toolCalls: [{ name: "driver_subagent", args: { task, ...(gate !== undefined && { gate }) } }] };
}

/** A tool call that parks the run inside its tool until the gate opens. */
export function holdAt(gate: string, text?: string): ScriptedTurn {
	return { ...(text !== undefined && { text: [text] }), toolCalls: [{ name: "driver_hold", args: { gate } }] };
}

/** The model a request ran with, as the wire id the adapter lists it by; with a gate, a hold follows it. */
export function echoModel(gate?: string): ScriptStep {
	return (request: ScriptedRequest) => ({
		text: [`${PROVIDER}/${request.model}`],
		...(gate !== undefined && { toolCalls: [{ name: "driver_hold", args: { gate } }] }),
	});
}

/** A provider failure: `529 overloaded` is one Pi retries, a `400` one it does not. */
export function failWith(status: number, error?: string): ScriptedTurn {
	return { status, ...(error !== undefined && { error }) };
}

export function scenarioSteps(router: PiRouter, sessionId: string, scenario: Scenario): ScriptStep[] | undefined {
	switch (scenario.kind) {
		case "reply":
			return [{ thinking: ["Thinking it over."], text: [REPLY_TEXT] }];
		case "tool":
			return [readReadme(), say("Read it.")];
		case "hold":
			return [holdAt(router.newGate(sessionId), "Working."), say("Done.")];
		case "echo_model":
			return [echoModel(router.newGate(sessionId)), echoModel()];
		case "feature":
			return featureSteps(scenario.feature);
		case "interaction":
			return interactionSteps(scenario.interaction);
	}
}

function featureSteps(feature: Extract<Scenario, { kind: "feature" }>["feature"]): ScriptStep[] | undefined {
	switch (feature) {
		case "thinking":
			return [{ thinking: ["Let me think."], text: ["Done."] }];
		case "usage":
			return [say(REPLY_TEXT)];
		case "children":
			return [subagent("Find the readme."), say("Delegated.")];
		case "plan_proposal":
			return undefined;
	}
}

function interactionSteps(kind: Extract<Scenario, { kind: "interaction" }>["interaction"]): ScriptStep[] | undefined {
	switch (kind) {
		case "tool_permission":
			return [readReadme(), say("Read it.")];
		case "choice":
			return [askHuman("select", "A choice question", { options: ["retry", "edit"] }), say("Thanks.")];
		case "confirm":
			return [askHuman("confirm", "A confirm question"), say("Thanks.")];
		case "text":
			return [askHuman("input", "A text question"), say("Thanks.")];
		case "questions":
		case "form":
		case "plan_approval":
			return undefined;
	}
}
