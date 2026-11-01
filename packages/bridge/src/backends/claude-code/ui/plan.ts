/** Lane E · ExitPlanMode as `plan_approval` (D13, D25): the plan from `input.plan`, `modeAfter` as a `setMode` update. */

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PlanApprovalReply, PlanApprovalRequest, PlanModeOptions } from "../../../contract";

export function planApprovalRequest(
	_input: Record<string, unknown>,
	_modeOptions: PlanModeOptions | undefined,
): PlanApprovalRequest | undefined {
	return undefined;
}

export function planResult(_input: Record<string, unknown>, _reply: PlanApprovalReply): PermissionResult | undefined {
	return undefined;
}
