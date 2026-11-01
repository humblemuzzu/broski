/** `canUseTool` as `tool_permission` (D13): plain allow/deny once always, one option per suggested grant, deny-and-stop. */

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import {
	type InteractionOrigin,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type ToolPermissionReply,
	type ToolPermissionRequest,
} from "../../../contract";
import { clip, nameOr } from "../bounds";
import { toolCallId } from "../ids";
import { boundedJson } from "../json";
import { toolTitle } from "../mapping/tool-titles";
import { DENY_ONCE, type OptionEffect, permissionChoices } from "./permission-options";
import { permissionPreviews } from "./permission-previews";
import { reportAskProblem } from "./problems";
import { plain } from "./text";
import { DENIED_MESSAGE, type ToolAsk, textOr } from "./tool-ask";

export type PermissionAskOptions = Parameters<CanUseTool>[2];

export interface PermissionAsk {
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly options: PermissionAskOptions;
}

export function permissionAsk(ask: PermissionAsk): ToolAsk {
	const { toolName, input, options } = ask;
	const choices = permissionChoices(options.suggestions ?? [], options.suppressAlwaysAllowRule === true);
	const reason = options.decisionReason === undefined ? undefined : plain(options.decisionReason, MAX_TEXT_CHARS);
	const request: ToolPermissionRequest = {
		kind: "tool_permission",
		input: boundedJson(input),
		inputEditable: false,
		...(reason !== undefined && reason !== "" && { reason }),
		previews: permissionPreviews(toolName, input, options.blockedPath),
		options: choices.options,
		grants: [],
		...(options.defaultToNo === true && { defaultOptionId: DENY_ONCE }),
		deliberate: requiresUserInteraction(options),
	};
	const description = options.description === undefined ? "" : plain(options.description, MAX_TEXT_CHARS).trim();
	return {
		title: nameOr(plain(options.title ?? "", MAX_NAME_CHARS), fallbackTitle(ask)),
		...(description !== "" && { body: description }),
		request,
		decide: (reply) => (reply.kind === "tool_permission" ? permitted(choices.effects, input, reply) : undefined),
	};
}

/** The ask when nothing richer could be built: plain allow once, deny once, deny and stop, and no input shown. */
export function minimalPermissionAsk(toolName: string, input: Record<string, unknown>): ToolAsk {
	const { options, effects } = permissionChoices([], true);
	return {
		title: `Allow ${plain(toolName, MAX_NAME_CHARS - 8)}?`,
		request: { kind: "tool_permission", inputEditable: false, previews: [], options, grants: [], deliberate: true },
		decide: (reply) => (reply.kind === "tool_permission" ? permitted(effects, input, reply) : undefined),
	};
}

export function permissionOrigin(ask: PermissionAsk): InteractionOrigin {
	const id = toolCallId(ask.options.toolUseID);
	return { ...(id !== undefined && { toolCallId: id }), toolName: plain(ask.toolName, MAX_NAME_CHARS) };
}

/** The CLI sets it when a one-tap answer must not be offered; the declared options omit it, the runtime passes it. */
export function requiresUserInteraction(options: PermissionAskOptions): boolean {
	return "requiresUserInteraction" in options && options.requiresUserInteraction === true;
}

/** Lane B's one-line title for the call when the CLI worded none; its failure costs the title only. */
function fallbackTitle(ask: PermissionAsk): string {
	try {
		const title = toolTitle(ask.toolName, ask.input);
		if (title !== undefined) return plain(title, MAX_NAME_CHARS);
	} catch (error) {
		reportAskProblem("tool title", error);
	}
	return `Allow ${displayName(ask)}?`;
}

function displayName(ask: PermissionAsk): string {
	return clip(plain(ask.options.displayName ?? ask.toolName, MAX_NAME_CHARS), MAX_NAME_CHARS - 8);
}

function permitted(
	effects: ReadonlyMap<string, OptionEffect>,
	input: Record<string, unknown>,
	reply: ToolPermissionReply,
): PermissionResult | undefined {
	const chosen = effects.get(reply.optionId);
	if (!chosen) return undefined;
	if (chosen.effect === "deny") {
		return {
			behavior: "deny",
			message: textOr(reply.message, DENIED_MESSAGE),
			...(chosen.stopsRun && { interrupt: true }),
		};
	}
	return {
		behavior: "allow",
		updatedInput: input,
		...(chosen.updates.length > 0 && { updatedPermissions: [...chosen.updates] }),
		...(chosen.persistent && { decisionClassification: "user_permanent" }),
	};
}
