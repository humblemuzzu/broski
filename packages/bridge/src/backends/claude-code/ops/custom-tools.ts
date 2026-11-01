/** `custom_tools` (D30): Broski's own tools, served to every session, as a list with test and delete. */

import { type BackendCallResult, type CustomToolsOp, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../../contract";
import { clip } from "../bounds";
import type { CustomToolsPort, OpsDeps } from "../ports";
import { isRejected, rejected } from "../rejections";
import { guarded } from "./guard";
import { messageOf } from "./host-access";
import { action, actionList, askedAction, findAction, type RowSpec } from "./list-rows";

export const NO_PORT = "Broski's custom tools are not available in this bridge";

/** D121: the port moves a deleted definition to the Mac's trash; a failed move keeps the tool. */
export const DELETE_CONFIRM = "The tool's definition goes to the Trash on the Mac, where it can be restored.";

async function rowsOf(port: CustomToolsPort): Promise<RowSpec[]> {
	return (await port.list()).map((tool) => ({
		id: tool.toolId,
		title: tool.name,
		subtitle: tool.description,
		status: tool.enabled ? { label: "enabled", tone: "ok" as const } : { label: "disabled", tone: "neutral" as const },
		badges: [clip(tool.handler, MAX_NAME_CHARS)],
		actions: [action("test", "Test"), askedAction("delete", "Delete", DELETE_CONFIRM)],
	}));
}

async function test(port: CustomToolsPort, toolId: string): Promise<string> {
	try {
		const run = await port.test(toolId);
		return clip(run.ok ? run.output : `Failed: ${run.output}`, MAX_TEXT_CHARS);
	} catch (error) {
		return `Failed: ${messageOf(error)}`;
	}
}

export async function customTools(deps: OpsDeps, op: CustomToolsOp): Promise<BackendCallResult> {
	return guarded("custom_tools", async () => {
		const port = deps.services.customTools;
		if (port === undefined) return rejected("unsupported", NO_PORT);
		if (op.change === undefined) return { kind: "custom_tools", list: actionList(await rowsOf(port)) };
		const found = findAction(actionList(await rowsOf(port)).rows, op.change);
		if (isRejected(found)) return found;
		let note: string;
		if (found.action.id === "test") note = await test(port, found.row.id);
		else if (await port.remove(found.row.id)) note = `Deleted ${found.row.title}.`;
		else return rejected("not_found", `no custom tool ${found.row.id}`);
		return { kind: "custom_tools", list: actionList(await rowsOf(port), note) };
	});
}
