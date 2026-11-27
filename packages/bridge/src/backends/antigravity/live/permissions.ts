/**
 * `session/request_permission` as the contract's `tool_permission`, and the person's answer back. Each option is
 * agy's own, by its id and name; its `kind` (ACP `PermissionOptionKind`) says whether it allows or rejects, and for how
 * long (agy 1.5.18 offers `allow_once` and `reject_once` alone). No option is the default and none stops the run: a
 * rejection lets agy go on without the tool. A request none of whose options says what it does still goes to the
 * person, who can only refuse it (ACP's `cancelled` outcome), since there is nothing honest to allow. The request's
 * tool call is read as agy reported it so far, since a request may name only the call's id.
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
	readonly body?: string;
	readonly request: ToolPermissionRequest;
	/** The `session/request_permission` result for a reply `answerProblem` passed; a dismissal leaves the tool unrun. */
	readonly result: (reply: InteractionReply) => PermissionResult;
}

type PermissionResult = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

export const PERMISSION_CANCELLED: PermissionResult = { outcome: { outcome: "cancelled" } };

const UNREADABLE =
	"Antigravity offered no choice Broski can read, so refusing is all Broski can send. Nothing is answered for you.";
const REFUSE: PermissionOption = {
	id: "refuse",
	label: "Refuse",
	effect: "deny",
	scope: "once",
	stopsRun: false,
	message: "none",
};

const KINDS = new Map<string, Pick<PermissionOption, "effect" | "scope">>([
	["allow_once", { effect: "allow", scope: "once" }],
	["allow_always", { effect: "allow", scope: "always" }],
	["reject_once", { effect: "deny", scope: "once" }],
	["reject_always", { effect: "deny", scope: "always" }],
]);

export function permissionAsk(params: PermissionRequest, tool: ToolState): PermissionAsk {
	const options = params.options.flatMap(optionOf).slice(0, MAX_LIST_ITEMS);
	const look = toolLook(tool);
	const reason = phoneText(toolArgument(tool, "toolSummary") ?? "");
	const request: ToolPermissionRequest = {
		kind: "tool_permission",
		...(tool.rawInput !== undefined && { input: boundedJson(tool.rawInput) }),
		inputEditable: false,
		...(reason !== "" && { reason }),
		previews: previewsOf(tool),
		options: options.length > 0 ? options : [REFUSE],
		grants: [],
		deliberate: false,
	};
	const title = phoneName(tool.title ?? look.title ?? "") || `Antigravity asks to use ${look.name}`;
	if (options.length === 0) return { title, body: UNREADABLE, request, result: () => PERMISSION_CANCELLED };
	return {
		title,
		request,
		result: (reply) =>
			reply.kind === "tool_permission"
				? { outcome: { outcome: "selected", optionId: reply.optionId } }
				: PERMISSION_CANCELLED,
	};
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
