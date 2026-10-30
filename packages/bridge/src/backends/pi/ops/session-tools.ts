/**
 * `backend.call` `session_tools` (contract README §13): the session's tools and which are on. `setActiveToolsByName`
 * (pi `dist/core/agent-session.js:1119`) rebuilds the system prompt at once and the change reaches the model on the
 * next turn. Nothing is saved to `settings.json`: the loadout reaches the session file as the system message written
 * when the next prompt is prepared (`:1323`), and a reopened session restores it from there (`:1389`), as in the terminal.
 */

import type { AgentSession, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
	type BackendCallResult,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	type Rejected,
	type SessionTool,
	type SessionToolsOp,
	type ToolChange,
} from "../../../contract";
import { clipStart } from "../bounds";
import { rejected } from "../rejections";

/** A description is a sentence or a paragraph; this keeps 1,000 of them far inside a frame. */
const DESCRIPTION_CHARS = 2_048;
const ELLIPSIS = "…";

/** Hidden tools are never declared to the model and cannot be switched (`dist/core/agent-session.js:1175-1179`). */
function listed(session: AgentSession): ToolInfo[] {
	return session.getAllTools().filter((tool) => tool.exposure !== "hidden");
}

export function readTools(session: AgentSession): { tools: SessionTool[]; omitted: number } {
	const active = new Set(session.getActiveToolNames());
	const all = listed(session);
	const tools = all.slice(0, MAX_LIST_ITEMS).map((tool) => entryOf(tool, active.has(tool.name)));
	return { tools, omitted: all.length - tools.length };
}

function entryOf(tool: ToolInfo, active: boolean): SessionTool {
	const group = tool.namespace?.name ?? (tool.sourceInfo.source === "builtin" ? "Built-in" : tool.sourceInfo.source);
	return {
		name: clipStart(tool.name, MAX_NAME_CHARS),
		description: cutDescription(tool.description),
		active,
		group: clipStart(group, MAX_NAME_CHARS),
	};
}

function cutDescription(text: string): string {
	if (text.length <= DESCRIPTION_CHARS) return text;
	return clipStart(text, DESCRIPTION_CHARS - ELLIPSIS.length) + ELLIPSIS;
}

export function sessionTools(session: AgentSession, op: SessionToolsOp): BackendCallResult {
	if (op.change !== undefined) {
		const problem = switchTool(session, op.change);
		if (problem !== undefined) return problem;
	}
	const { tools, omitted } = readTools(session);
	return { status: "accepted", result: { kind: "session_tools", tools, ...(omitted > 0 && { omitted }) } };
}

function switchTool(session: AgentSession, change: ToolChange): Rejected | undefined {
	if (!listed(session).some((tool) => tool.name === change.name)) {
		return rejected("not_found", `the session has no tool ${change.name}`);
	}
	const names = new Set(session.getActiveToolNames());
	if (change.active) names.add(change.name);
	else names.delete(change.name);
	session.setActiveToolsByName([...names]);
	return session.getActiveToolNames().includes(change.name) === change.active
		? undefined
		: rejected(
				"unsupported",
				`Pi does not let ${change.name} be turned ${change.active ? "on" : "off"} in this session`,
			);
}
