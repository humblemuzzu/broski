/**
 * `session/request_permission` as the contract's `tool_permission`, and the person's answer back. Each option is
 * agy's own, by its id and name; its `kind` (ACP `PermissionOptionKind`) says whether it allows or rejects, and for how
 * long (agy 1.5.18 offers `allow_once` and `reject_once` alone). No option is the default and none stops the run: a
 * rejection lets agy go on without the tool. The request's tool call is read as agy reported it so far, since a
 * request may name only the call's id.
 */

import { boundedJson } from "../../../adapter-kit/bounded-json";
import { phoneName, phoneText } from "../../../adapter-kit/phone-text";
import {
	type InteractionReply,
	MAX_ID_CHARS,
	MAX_LIST_ITEMS,
	MAX_PATH_CHARS,
	type PermissionOption,
	type PermissionPreview,
	type ToolPermissionRequest,
} from "../../../contract";
import type { PermissionRequest } from "../acp/frames";
import { fileChangesOf, type ToolState, toolArgument, toolLook } from "../mapping/tools";

export interface PermissionAsk {
	readonly title: string;
	readonly request: ToolPermissionRequest;
}

const KINDS = new Map<string, Pick<PermissionOption, "effect" | "scope">>([
	["allow_once", { effect: "allow", scope: "once" }],
	["allow_always", { effect: "allow", scope: "always" }],
	["reject_once", { effect: "deny", scope: "once" }],
	["reject_always", { effect: "deny", scope: "always" }],
]);

/** Undefined when none of agy's options says what it does: there is nothing honest to offer. */
export function permissionAsk(params: PermissionRequest, tool: ToolState): PermissionAsk | undefined {
	const options = params.options.flatMap(optionOf).slice(0, MAX_LIST_ITEMS);
	if (options.length === 0) return undefined;
	const look = toolLook(tool);
	const reason = phoneText(toolArgument(tool, "toolSummary") ?? "");
	return {
		title: phoneName(tool.title ?? look.title ?? "") || `Antigravity asks to use ${look.name}`,
		request: {
			kind: "tool_permission",
			...(tool.rawInput !== undefined && { input: boundedJson(tool.rawInput) }),
			inputEditable: false,
			...(reason !== "" && { reason }),
			previews: previewsOf(tool),
			options,
			grants: [],
			deliberate: false,
		},
	};
}

/** The `session/request_permission` result for a reply `answerProblem` passed; a dismissal leaves the tool unrun. */
export function permissionResult(reply: InteractionReply): { outcome: Record<string, string> } {
	return reply.kind === "tool_permission"
		? { outcome: { outcome: "selected", optionId: reply.optionId } }
		: { outcome: { outcome: "cancelled" } };
}

function optionOf(option: PermissionRequest["options"][number]): PermissionOption[] {
	const kind = KINDS.get(option.kind);
	const { optionId } = option;
	if (kind === undefined || optionId === "" || optionId.length > MAX_ID_CHARS) return [];
	return [{ id: optionId, label: phoneName(option.name) || optionId, ...kind, stopsRun: false, message: "none" }];
}

function previewsOf(tool: ToolState): PermissionPreview[] {
	const command = toolArgument(tool, "CommandLine");
	if (tool.name === "run_command" && command !== undefined) return [{ kind: "command", command: phoneText(command) }];
	const changes = fileChangesOf(tool.content);
	if (changes.length > 0) return [{ kind: "file_changes", changes }];
	const paths = tool.locations
		.map((location) => location.path)
		.filter((path) => path !== "" && path.length <= MAX_PATH_CHARS)
		.slice(0, MAX_LIST_ITEMS);
	return paths.length > 0 ? [{ kind: "paths", paths }] : [];
}
