/** ExitPlanMode as `plan_approval` (D17): the plan from `input.plan`, `modeAfter` as a `setMode` update. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
	type PlanApprovalReply,
	type PlanApprovalRequest,
	type PlanModeOptions,
} from "../../../contract";
import { clip } from "../bounds";
import { isPermissionMode } from "../permission-modes";
import { humanDenial } from "./denial";
import { type ToolAsk, textOr } from "./tool-ask";

const KEEP_PLANNING = "The user wants the plan revised before any work starts.";

export function planAsk(input: Record<string, unknown>, modeOptions: PlanModeOptions | undefined): ToolAsk {
	const plan = typeof input.plan === "string" ? input.plan : undefined;
	const path = typeof input.planFilePath === "string" ? input.planFilePath : undefined;
	const editable = plan !== undefined && plan.length <= MAX_TEXT_CHARS;
	const offered = modeOptions && withDefault(modeOptions);
	const request: PlanApprovalRequest = {
		kind: "plan_approval",
		plan: clip(plan ?? "", MAX_TEXT_CHARS),
		editable,
		...(path !== undefined && path !== "" && path.length <= MAX_PATH_CHARS && { path }),
		...(offered && { modeOptions: offered }),
	};
	return {
		title: "Plan ready for review",
		request,
		decide: (reply) => (reply.kind === "plan_approval" ? decided(input, plan, offered, reply) : undefined),
	};
}

/** The plan's mode choice starts on `default` when the host did not name one (D17). */
function withDefault(options: PlanModeOptions): PlanModeOptions {
	if (options.defaultValue !== undefined) return options;
	return options.options.some((option) => option.value === "default")
		? { ...options, defaultValue: "default" }
		: options;
}

function decided(
	input: Record<string, unknown>,
	plan: string | undefined,
	offered: PlanModeOptions | undefined,
	reply: PlanApprovalReply,
): PermissionResult | undefined {
	if (reply.decision === "reject")
		return { behavior: "deny", message: humanDenial(textOr(reply.feedback, KEEP_PLANNING)) };
	const mode = reply.modeAfter ?? offered?.defaultValue;
	if (mode !== undefined && !isPermissionMode(mode)) return undefined;
	const edited = reply.plan !== undefined && reply.plan !== plan;
	return {
		behavior: "allow",
		updatedInput: edited ? { ...input, plan: reply.plan } : input,
		...(mode !== undefined && { updatedPermissions: [{ type: "setMode", mode, destination: "session" }] }),
	};
}
