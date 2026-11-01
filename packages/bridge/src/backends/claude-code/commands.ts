/** Lane C · `CommandSummary`s from `initialize.commands`: skills marked, terminal-only commands hidden (D10). */

import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import { type CommandSummary, MAX_CATALOG_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "../../contract";
import { boundList, clip } from "./bounds";
import { commandId } from "./ids";

/**
 * The built-in commands the CLI tags `terminalOriented`, whose UX is bound to the local terminal (the `init` frame lists
 * them as `terminal_slash_commands`, `d.ts:6264`; "phone/remote UIs should hide these"). `initialize` carries no such
 * tag and the frame comes only with a turn, so the names are fixed for the pinned CLI and held to the frame by
 * `T/catalogue/real_catalogue.test.ts`.
 */
const TERMINAL_BUILTINS: ReadonlySet<string> = new Set([
	"color",
	"doctor",
	"exit",
	"focus",
	"reload-plugins",
	"send-to-project",
	"statusline",
]);

/**
 * The row `/name` runs when rows share a name: the marked one if any, else the first (`SlashCommand.builtin`, `d.ts:9799`).
 */
function runnableRows(commands: readonly SlashCommand[]): Map<string, SlashCommand> {
	const rows = new Map<string, SlashCommand>();
	for (const row of commands) {
		const id = commandId(row.name);
		if (id === undefined || (row.builtin === true && TERMINAL_BUILTINS.has(id))) continue;
		const kept = rows.get(id);
		if (kept === undefined || (kept.builtin !== true && row.builtin === true)) rows.set(id, row);
	}
	return rows;
}

function summary(id: string, row: SlashCommand, skills: ReadonlySet<string>): CommandSummary {
	const description = clip(row.description, MAX_TEXT_CHARS);
	const argumentHint = clip(row.argumentHint, MAX_NAME_CHARS);
	return {
		id,
		name: id,
		kind: skills.has(id) ? "skill" : "command",
		...(description !== "" && { description }),
		...(argumentHint !== "" && { argumentHint }),
	};
}

/**
 * What the phone lists: commands a user, project, plugin or MCP server defined first, then the CLI's own, each group in
 * the CLI's order (D61). A project command leading the list is what lets the conformance suite's "first command that
 * starts a run" reach the model as that command (STEP-3 §11); the CLI's built-ins that never reach the model follow.
 */
export function commandsOf(
	commands: readonly SlashCommand[],
	skills: ReadonlySet<string> = new Set(),
): CommandSummary[] {
	const rows = [...runnableRows(commands)];
	const defined = rows.filter(([, row]) => row.builtin !== true);
	const own = rows.filter(([, row]) => row.builtin === true);
	return boundList(
		[...defined, ...own].map(([id, row]) => summary(id, row, skills)),
		MAX_CATALOG_ITEMS,
	).items;
}
