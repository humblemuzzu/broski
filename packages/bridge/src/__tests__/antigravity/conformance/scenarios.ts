/**
 * Each conformance `Scenario` as what a real model is told. A real model is steered only by its prompt, so a scenario
 * is an instruction that takes the place of the next prompt's words (no rule reads a prompt's words back; a prompt
 * naming a command keeps its own). Each asks for something near-certain in agy's `default` mode: a read of the
 * workspace's README (agy asks for no read inside its folder) for a tool; a `touch` in the workspace, which agy asks
 * permission for and so waits until the permission is answered, for a hold and for a permission; agy's own
 * `ask_question` tool for questions. What agy cannot do is declined, and no rule needs it: a child session (agy's
 * subagent is a tool row, not a child stream), a plan proposal and every interaction kind but those two, none of which
 * agy declares; and a run naming its model's id (`echo_model`: a model does not know agy's id for it), so the model
 * rule checks a choice made mid-run at a hold, without which model each request ran with.
 */

import type { Scenario } from "../../../contract/testing/conformance-types";

export const REPLY = "Reply with exactly: ok";

export function instructionFor(scenario: Scenario): string | undefined {
	switch (scenario.kind) {
		case "reply":
			return REPLY;
		case "tool":
			return "Read the file README.md in the current folder with your file-reading tool, then reply with the magic word it names.";
		case "hold":
			return "Run the shell command `touch held.txt` in the current folder.";
		case "interaction":
			if (scenario.interaction === "tool_permission") {
				return "Run the shell command `touch conformance.txt` in the current folder, then reply with exactly: done";
			}
			if (scenario.interaction === "questions") {
				return 'Use your ask_question tool to ask me one question, "Which colour?", with exactly two options, Red and Blue. Then reply with the colour I chose, or with exactly: none if I chose none.';
			}
			return undefined;
		case "feature":
			if (scenario.feature === "thinking") {
				return "Think it through step by step, then reply with only the number: what is 17 times 23?";
			}
			return scenario.feature === "usage" ? REPLY : undefined;
		case "echo_model":
			return undefined;
	}
}
