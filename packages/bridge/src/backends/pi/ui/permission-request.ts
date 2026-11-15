/** What the phone is asked when the gate meets a tool call: the options, the previews and who is calling. */

import {
	type InteractionOrigin,
	type JsonValue,
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
	type PermissionOption,
	type PermissionPreview,
	type ToolPermissionRequest,
} from "../../../contract";
import { clipStart } from "../bounds";
import type { PermissionAsk } from "../host/protocol";
import type { ToolCallIds } from "../ids";
import { boundedJson } from "../json";
import { phoneName } from "../phone-text";
import { visibleText } from "./visible-text";

export const ALLOW_ONCE = "allow_once";
export const ALLOW_SESSION = "allow_session";
export const DENY = "deny";
export const DENY_STOP = "deny_stop";

const OPTIONS: readonly PermissionOption[] = [
	{ id: ALLOW_ONCE, label: "Allow", effect: "allow", scope: "once", stopsRun: false, message: "none" },
	{
		id: ALLOW_SESSION,
		label: "Allow for this session",
		effect: "allow",
		scope: "session",
		stopsRun: false,
		message: "none",
	},
	{ id: DENY, label: "Deny", effect: "deny", scope: "once", stopsRun: false, message: "optional" },
	{ id: DENY_STOP, label: "Deny and stop", effect: "deny", scope: "once", stopsRun: true, message: "none" },
];

const EDIT_REFUSED = "The edited input did not fit the tool, so nothing ran: ";

const CUT_REASON =
	"The input is longer than the phone can show: only its start is shown, and it cannot be edited here. Allowing runs all of it.";

/**
 * No option is the default: an approval is the human's choice. When the input does not fit the contract's bounds
 * the phone shows its start, so it may not be edited (an edit would replace the call with the cut copy), the request
 * says so, and no one-tap answer is offered. An ask made again because the human's edit did not fit the tool says why.
 */
export function permissionRequest(ask: PermissionAsk): ToolPermissionRequest {
	const input = boundedJson(ask.input);
	const cut = !sameJson(ask.input, input);
	const reason = cut ? CUT_REASON : ask.problem === undefined ? undefined : `${EDIT_REFUSED}${ask.problem}`;
	return {
		kind: "tool_permission",
		input,
		inputEditable: !cut,
		...(reason !== undefined && { reason: clipStart(reason, MAX_TEXT_CHARS) }),
		previews: previewsOf(ask),
		options: [...OPTIONS],
		grants: [],
		deliberate: cut,
	};
}

export function permissionTitle(toolName: string): string {
	return clipStart(`Allow ${phoneName(toolName)}?`, MAX_NAME_CHARS);
}

/** Both ids are the live ones the run's table holds, unknown to it when no run is active. */
export function permissionOrigin(ask: PermissionAsk, tools: ToolCallIds | undefined): InteractionOrigin {
	const toolCallId = tools?.find(ask.toolCallId);
	const parentToolCallId = ask.parentToolCallId === undefined ? undefined : tools?.find(ask.parentToolCallId);
	return {
		...(toolCallId !== undefined && { toolCallId }),
		toolName: phoneName(ask.toolName),
		...(parentToolCallId !== undefined && { parentToolCallId }),
	};
}

/** What will run, every character visible (`visibleText`), and said to be cut where it is. */
function previewsOf(ask: PermissionAsk): PermissionPreview[] {
	const command = stringField(ask.input, "command");
	if (ask.toolName === "bash" && command !== undefined) {
		return [{ kind: "command", command: shownCut(command, MAX_TEXT_CHARS), cwd: shownCut(ask.cwd, MAX_PATH_CHARS) }];
	}
	const path = stringField(ask.input, "path");
	return path === undefined || path === "" ? [] : [{ kind: "paths", paths: [shownCut(path, MAX_PATH_CHARS)] }];
}

function shownCut(text: string, max: number): string {
	const visible = visibleText(text);
	if (visible.length <= max) return visible;
	const note = ` … [${visible.length - max} more characters not shown]`;
	return `${clipStart(visible, max - note.length)}${note}`;
}

function sameJson(original: unknown, shown: JsonValue): boolean {
	try {
		return JSON.stringify(original) === JSON.stringify(shown);
	} catch {
		return false;
	}
}

function stringField(input: unknown, key: string): string | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const value = Object.getOwnPropertyDescriptor(input, key)?.value;
	return typeof value === "string" ? value : undefined;
}
