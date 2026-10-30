/**
 * The faux model's script for each conformance `Scenario`, as Pi can play it. A scenario Pi lacks
 * (plan, plan proposals, structured forms) has no script: the driver answers `false`.
 */

import {
	type AssistantMessage,
	type FauxContentBlock,
	type FauxResponseFactory,
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Scenario } from "../../../contract/testing/conformance-types";
import type { DriverBus } from "./driver-bus";

export const REPLY_TEXT = "Here is the answer.";

/** One response that asks for tools and so continues the run. */
export function toolUse(...content: FauxContentBlock[]): AssistantMessage {
	return fauxAssistantMessage(content, { stopReason: "toolUse" });
}

export function say(text: string): AssistantMessage {
	return fauxAssistantMessage(text);
}

export function readReadme(): AssistantMessage {
	return toolUse(fauxToolCall("read", { path: "README.md" }));
}

export function askHuman(
	dialog: "select" | "confirm" | "input" | "editor",
	title: string,
	extra: { options?: string[]; timeoutMs?: number; withSignal?: boolean; ownSignal?: boolean; tag?: string } = {},
): AssistantMessage {
	return toolUse(fauxToolCall("ask_human", { tag: extra.tag ?? dialog, dialog, title, ...extra }));
}

/** A call of the driver's subagent tool; with a gate, the tool parks after its first update. */
export function subagent(task: string, gate?: string): AssistantMessage {
	return toolUse(fauxToolCall("driver_subagent", { task, ...(gate !== undefined && { gate }) }));
}

export function holdAt(gate: string, ...before: FauxContentBlock[]): AssistantMessage {
	return toolUse(...before, fauxToolCall("driver_hold", { gate }));
}

/** A response whose only text is the model it was asked of (`provider/id`), optionally ending at a hold. */
export function echoModel(gate?: string): FauxResponseFactory {
	return (_context, _options, _state, model) => {
		const echo = fauxText(`${model.provider}/${model.id}`);
		return gate === undefined ? fauxAssistantMessage([echo]) : holdAt(gate, echo);
	};
}

export function scenarioSteps(bus: DriverBus, sessionId: string, scenario: Scenario): FauxResponseStep[] | undefined {
	switch (scenario.kind) {
		case "reply":
			return [fauxAssistantMessage([fauxThinking("Thinking it over."), fauxText(REPLY_TEXT)])];
		case "tool":
			return [readReadme(), say("Read it.")];
		case "hold":
			return [holdAt(bus.newGate(sessionId), fauxText("Working.")), say("Done.")];
		case "echo_model":
			return [echoModel(bus.newGate(sessionId)), echoModel()];
		case "feature":
			return featureSteps(scenario.feature);
		case "interaction":
			return interactionSteps(scenario.interaction);
	}
}

function featureSteps(feature: Extract<Scenario, { kind: "feature" }>["feature"]): FauxResponseStep[] | undefined {
	switch (feature) {
		case "thinking":
			return [fauxAssistantMessage([fauxThinking("Let me think."), fauxText("Done.")])];
		case "usage":
			return [say(REPLY_TEXT)];
		case "children":
			return [subagent("Find the readme."), say("Delegated.")];
		case "plan":
		case "plan_proposal":
			return undefined;
	}
}

function interactionSteps(
	kind: Extract<Scenario, { kind: "interaction" }>["interaction"],
): FauxResponseStep[] | undefined {
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
		case "external_url":
			return undefined;
	}
}

/** The message of a transient provider failure Pi retries (pi-ai `retry.ts`: "overloaded"). */
export const OVERLOADED = "529 overloaded_error: Overloaded";

/** A response that fails with `errorMessage`. */
export function failWith(errorMessage: string): AssistantMessage {
	return fauxAssistantMessage([], { stopReason: "error", errorMessage });
}
