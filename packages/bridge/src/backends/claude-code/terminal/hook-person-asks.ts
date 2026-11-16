/**
 * A terminal's AskUserQuestion and ExitPlanMode through its `PermissionRequest` hook (D29): the questions and the plan
 * the hosted desk shows (`ui/questions.ts`, `ui/plan.ts`), answered by an allow that carries `updatedInput` (the
 * answers, or the plan), which the CLI takes in place of its own card. A bare allow answers neither (CLI 2.1.325: the
 * hook's allow is ignored for a tool that requires user interaction unless it brings `updatedInput`; hooks reference,
 * "Tools that require user interaction"). The terminal's card stays up meanwhile, and the first answer wins.
 */

import type { PermissionRequestHookInput, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { MAX_NAME_CHARS } from "../../../contract";
import { nameOr } from "../bounds";
import { isRecord } from "../json";
import { phoneText } from "../phone-text";
import { planAsk } from "../ui/plan";
import { questionsAsk } from "../ui/questions";
import type { ToolAsk } from "../ui/tool-ask";
import { type AskContext, cancelDecision, type HookAsk, type HookDecision } from "./hook-interaction";

/** Undefined for another tool, or for questions the app cannot show: the terminal's own card then answers them. */
export function personAsk(ask: PermissionRequestHookInput, context: AskContext): HookAsk | undefined {
	const input = isRecord(ask.tool_input) ? ask.tool_input : undefined;
	if (input === undefined) return undefined;
	const asked = askOf(ask.tool_name, input);
	if (asked === undefined) return undefined;
	return {
		interaction: {
			id: context.id,
			...(context.runId !== undefined && { runId: context.runId }),
			createdAt: context.createdAt,
			title: asked.title,
			...(asked.body !== undefined && { body: asked.body }),
			blocksRun: context.runId !== undefined,
			origin: {
				toolName: nameOr(phoneText(ask.tool_name, MAX_NAME_CHARS), "tool"),
				...(context.toolCallId !== undefined && { toolCallId: context.toolCallId }),
			},
			request: asked.request,
		},
		decide: (reply) => (reply.kind === "cancel" ? cancelDecision(reply) : hookDecision(asked.decide(reply))),
	};
}

/** Whether the phone can show this person's ask; one it cannot is left to the terminal before anything is held. */
export function personAskShowable(ask: PermissionRequestHookInput): boolean {
	return isRecord(ask.tool_input) && askOf(ask.tool_name, ask.tool_input) !== undefined;
}

function askOf(toolName: string, input: Record<string, unknown>): ToolAsk | undefined {
	switch (toolName) {
		case "AskUserQuestion":
			return questionsAsk(input);
		case "ExitPlanMode":
			return planAsk(input, undefined);
		default:
			return undefined;
	}
}

function hookDecision(result: PermissionResult | undefined): HookDecision | undefined {
	if (result === undefined) return undefined;
	if (result.behavior === "deny") {
		return {
			decision: { behavior: "deny", message: result.message, ...(result.interrupt === true && { interrupt: true }) },
		};
	}
	return {
		decision: {
			behavior: "allow",
			...(result.updatedInput !== undefined && { updatedInput: result.updatedInput }),
			...(result.updatedPermissions !== undefined && { updatedPermissions: result.updatedPermissions }),
		},
	};
}
