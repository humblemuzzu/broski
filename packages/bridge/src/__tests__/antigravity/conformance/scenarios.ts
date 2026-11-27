/**
 * Each conformance `Scenario` as what a real model is told. A real model is steered only by its prompt, so a scenario
 * is an instruction that takes the place of the next prompt's words (no rule reads a prompt's words back; a prompt
 * naming a command keeps its own). Each is near-certain in agy's `default` mode on any agy permission policy: a read
 * of the workspace's README with agy's own file tool (agy asks for no read inside its folder, but does ask before a
 * shell command such as `cat`, which no tool rule answers) for a tool; agy's `ask_question`
 * tool, which waits for the person on any policy, for a hold and for questions. A permission is a `touch`, which agy
 * asks for only where agy's policy asks first (else the rule fails saying so: the driver's `unasked`). Declined,
 * as no rule needs them: a child session (agy's subagent is a tool row), a plan proposal and every interaction kind
 * agy does not declare; and `echo_model` (a model does not know agy's id for it), so the model rule checks a choice
 * made mid-run at a hold. The thinking feature runs at the cheap model's highest level (`driver.ts`).
 */

import type { Scenario } from "../../../contract/testing/conformance-types";
import { HOLD_PROMPT, THINK_PROMPT } from "../live/runs";

export const REPLY = "Reply with exactly: ok";

export function instructionFor(scenario: Scenario): string | undefined {
	switch (scenario.kind) {
		case "reply":
			return REPLY;
		case "tool":
			return "Read the file README.md in the current folder with your read_file tool, not a shell command, then reply with the magic word it names.";
		case "hold":
			return HOLD_PROMPT;
		case "interaction":
			if (scenario.interaction === "tool_permission") {
				return "Run the shell command `touch conformance.txt` in the current folder, then reply with exactly: done";
			}
			if (scenario.interaction === "questions") {
				return 'Use your ask_question tool to ask me one question, "Which colour?", with exactly two options, Red and Blue. Then reply with the colour I chose, or with exactly: none if I chose none.';
			}
			return undefined;
		case "feature":
			if (scenario.feature === "thinking") return THINK_PROMPT;
			return scenario.feature === "usage" ? REPLY : undefined;
		case "echo_model":
			return undefined;
	}
}
