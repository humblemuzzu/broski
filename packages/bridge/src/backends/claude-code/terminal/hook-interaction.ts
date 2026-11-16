/**
 * A terminal's `PermissionRequest` hook as a `tool_permission` ask, and a person's reply as the hook's decision (D29):
 * allow once, the grants the terminal's own dialog would offer (its `permission_suggestions`), deny, deny and stop.
 */

import type { PermissionRequestHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
	type Interaction,
	type InteractionId,
	type InteractionReply,
	MAX_LIST_ITEMS,
	MAX_PATH_CHARS,
	type PermissionOption,
	type PermissionPreview,
	type RunId,
	type ToolCallId,
} from "../../../contract";
import { nameOr } from "../bounds";
import { boundedJson, isRecord } from "../json";
import { fileChangesOf } from "../mapping/file-changes";
import { toolTitle } from "../mapping/tool-titles";
import { phoneText } from "../phone-text";
import type { TerminalPermissionDecision } from "../ports/terminal";
import { humanDenial } from "../ui/denial";
import { grantChoices, type OptionEffect } from "../ui/permission-options";

export const ALLOW_ONCE = "allow-once";
export const DENY_ONCE = "deny-once";
const DENY_AND_STOP = "deny-and-stop";

const ALLOW: PermissionOption = {
	id: ALLOW_ONCE,
	label: "Allow once",
	effect: "allow",
	scope: "once",
	stopsRun: false,
	message: "none",
};

const DENIALS: readonly PermissionOption[] = [
	{
		id: DENY_ONCE,
		label: "Deny",
		effect: "deny",
		scope: "once",
		stopsRun: false,
		message: "optional",
	},
	{
		id: DENY_AND_STOP,
		label: "Deny and stop",
		effect: "deny",
		scope: "once",
		stopsRun: true,
		message: "optional",
	},
];

const DENIED_ON_PHONE = "Denied from the Broski app.";

/** In the CLI's own words, so the tail and history read the result `denied` (D18). */
function denial(message: string | undefined): string {
	return humanDenial(message ?? DENIED_ON_PHONE);
}

/** The tools whose terminal dialog is a question to the person, not a permission: a hook's allow would answer none. */
export function isPersonOnlyTool(toolName: string): boolean {
	return toolName === "AskUserQuestion" || toolName === "ExitPlanMode";
}

export interface AskContext {
	readonly id: InteractionId;
	readonly runId: RunId | undefined;
	readonly createdAt: number;
	readonly toolCallId: ToolCallId | undefined;
}

export interface HookAsk {
	readonly interaction: Interaction;
	/** What a reply decides; undefined for a reply that does not answer this ask. */
	readonly decide: (reply: InteractionReply) => HookDecision | undefined;
}

export function permissionAsk(ask: PermissionRequestHookInput, context: AskContext): HookAsk {
	const grants = grantChoices(ask.permission_suggestions ?? [], false);
	const options = [ALLOW, ...grants.options, ...DENIALS].slice(0, MAX_LIST_ITEMS);
	return {
		interaction: permissionInteraction(ask, context, options),
		decide: (reply) => decisionOf(reply, grants.effects),
	};
}

function permissionInteraction(
	ask: PermissionRequestHookInput,
	context: AskContext,
	options: PermissionOption[],
): Interaction {
	const title = toolTitle(ask.tool_name, ask.tool_input);
	return {
		id: context.id,
		...(context.runId !== undefined && { runId: context.runId }),
		createdAt: context.createdAt,
		title: nameOr(title ?? ask.tool_name, "Permission"),
		blocksRun: context.runId !== undefined,
		origin: {
			toolName: nameOr(ask.tool_name, "tool"),
			...(context.toolCallId !== undefined && {
				toolCallId: context.toolCallId,
			}),
		},
		request: {
			kind: "tool_permission",
			input: boundedJson(ask.tool_input),
			inputEditable: false,
			previews: previewsOf(ask),
			options,
			grants: [],
			deliberate: false,
		},
	};
}

function previewsOf(ask: PermissionRequestHookInput): PermissionPreview[] {
	const input = ask.tool_input;
	if (ask.tool_name === "Bash" && isRecord(input) && typeof input.command === "string") {
		return [
			{
				kind: "command",
				command: phoneText(input.command),
				cwd: phoneText(ask.cwd, MAX_PATH_CHARS),
			},
		];
	}
	const changes = fileChangesOf(ask.tool_name, input, undefined);
	return changes.length === 0 ? [] : [{ kind: "file_changes", changes }];
}

export type HookDecision = {
	readonly decision: TerminalPermissionDecision | undefined;
};

/**
 * What a person's reply decides. A cancel that does not stop the run gives no decision: the terminal then asks its own
 * user, as it does when the phone never answers.
 */
function decisionOf(reply: InteractionReply, grants: ReadonlyMap<string, OptionEffect>): HookDecision | undefined {
	switch (reply.kind) {
		case "tool_permission": {
			const grant = grants.get(reply.optionId);
			if (grant !== undefined) return { decision: { behavior: "allow", updatedPermissions: [...grant.updates] } };
			return toolPermissionDecision(reply.optionId, reply.message);
		}
		case "cancel":
			return {
				decision: reply.stopRun
					? {
							behavior: "deny",
							message: denial(reply.message),
							interrupt: true,
						}
					: undefined,
			};
		default:
			return undefined;
	}
}

function toolPermissionDecision(optionId: string, message: string | undefined): HookDecision | undefined {
	switch (optionId) {
		case ALLOW_ONCE:
			return { decision: { behavior: "allow" } };
		case DENY_ONCE:
			return {
				decision: { behavior: "deny", message: denial(message) },
			};
		case DENY_AND_STOP:
			return {
				decision: {
					behavior: "deny",
					message: denial(message),
					interrupt: true,
				},
			};
		default:
			return undefined;
	}
}
