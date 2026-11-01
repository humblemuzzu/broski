/** Lane B · a one-line title for a tool call (`Read README.md`, `Bash: ls`). Shared with lanes A, E and G. */

import { isRecord } from "../json";
import { phoneLine } from "../phone-text";

const TITLE_CHARS = 160;
const MCP_PREFIX = "mcp__";

/** Which field of the tool's input (`sdk-tools.d.ts` `*Input`) names the call, and how its title reads. */
type FieldTitle = readonly [field: string, label: string];

const FIELD_TITLES: ReadonlyMap<string, FieldTitle> = new Map<string, FieldTitle>([
	["Read", ["file_path", "Read"]],
	["Write", ["file_path", "Write"]],
	["Edit", ["file_path", "Edit"]],
	["NotebookEdit", ["notebook_path", "Edit notebook"]],
	["Glob", ["pattern", "Glob"]],
	["Grep", ["pattern", "Grep"]],
	["WebFetch", ["url", "Fetch"]],
	["WebSearch", ["query", "Search"]],
	["Agent", ["description", "Agent"]],
	["Task", ["description", "Agent"]],
	["TaskCreate", ["subject", "Create task"]],
	["ReadMcpResourceTool", ["uri", "Read resource"]],
	["CronCreate", ["prompt", "Schedule"]],
	["ScheduleWakeup", ["reason", "Wake up"]],
	["Monitor", ["description", "Monitor"]],
]);

const FIXED_TITLES: ReadonlyMap<string, string> = new Map<string, string>([
	["TodoWrite", "Update todo list"],
	["TaskUpdate", "Update task"],
	["TaskList", "List tasks"],
	["TaskGet", "Get task"],
	["TaskStop", "Stop task"],
	["AskUserQuestion", "Ask a question"],
	["ExitPlanMode", "Exit plan mode"],
	["EnterPlanMode", "Enter plan mode"],
	["EnterWorktree", "Enter worktree"],
	["ExitWorktree", "Exit worktree"],
]);

const SHELL_TOOLS: ReadonlySet<string> = new Set(["Bash", "PowerShell"]);

function textField(input: Record<string, unknown>, field: string): string | undefined {
	const value = input[field];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** `mcp__<server>__<tool>` as `<server>: <tool>`. */
function mcpTitle(toolName: string): string | undefined {
	if (!toolName.startsWith(MCP_PREFIX)) return undefined;
	const separator = toolName.indexOf("__", MCP_PREFIX.length);
	if (separator < 0) return undefined;
	const server = toolName.slice(MCP_PREFIX.length, separator);
	const tool = toolName.slice(separator + 2);
	return server === "" || tool === "" ? undefined : `${server}: ${tool}`;
}

function titled(title: string | undefined): string | undefined {
	if (title === undefined) return undefined;
	const line = phoneLine(title, TITLE_CHARS);
	return line === "" ? undefined : line;
}

/** `undefined` when the tool name alone says as much, so the app shows the name. */
export function toolTitle(toolName: string, input: unknown): string | undefined {
	const mcp = mcpTitle(toolName);
	if (mcp !== undefined) return titled(mcp);
	const fixed = FIXED_TITLES.get(toolName);
	if (fixed !== undefined) return fixed;
	if (!isRecord(input)) return undefined;
	if (SHELL_TOOLS.has(toolName)) {
		const command = textField(input, "command");
		return command === undefined ? undefined : titled(`${toolName}: ${command.trim().split("\n", 1)[0]}`);
	}
	const entry = FIELD_TITLES.get(toolName);
	if (entry === undefined) return undefined;
	const value = textField(input, entry[0]);
	return value === undefined ? undefined : titled(`${entry[1]} ${value}`);
}
