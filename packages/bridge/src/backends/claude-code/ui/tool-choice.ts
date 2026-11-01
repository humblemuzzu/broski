/** Which ask a `canUseTool` call becomes; a failure to build the rich one still leaves a plain allow/deny for a person. */

import type { PlanModeOptions } from "../../../contract";
import { minimalPermissionAsk, type PermissionAsk, permissionAsk } from "./permission";
import { planAsk } from "./plan";
import { isValidAsk } from "./probe";
import { reportAskProblem } from "./problems";
import { declinedQuestions, questionsAsk } from "./questions";
import type { ToolAsk } from "./tool-ask";

export function chooseToolAsk(ask: PermissionAsk, planModeOptions: () => PlanModeOptions | undefined): ToolAsk {
	try {
		const rich = richToolAsk(ask, planModeOptions);
		if (isValidAsk(rich)) return rich;
		reportAskProblem(`${ask.toolName} ask`, new Error("the contract refuses the interaction built for it"));
	} catch (error) {
		reportAskProblem(`${ask.toolName} ask`, error);
	}
	return minimalPermissionAsk(ask.toolName, ask.input);
}

function richToolAsk(ask: PermissionAsk, planModeOptions: () => PlanModeOptions | undefined): ToolAsk {
	switch (ask.toolName) {
		case "AskUserQuestion":
			return questionsAsk(ask.input) ?? declinedQuestions();
		case "ExitPlanMode":
			return planAsk(ask.input, planModeOptions());
		default:
			return permissionAsk(ask);
	}
}
