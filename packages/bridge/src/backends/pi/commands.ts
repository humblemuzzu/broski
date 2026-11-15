/**
 * `listCommands`: the extension commands, prompt templates and skills `get_commands` names (pi-coding-agent 1.5.2
 * `docs/rpc-commands.md:786-834`), as the contract's commands. RPC gives a template no argument hint, so none has one.
 * Pi's own TUI commands are not listed by Pi; the contract has `compact`, `setModel` and `session.create` for them.
 */

import { type CommandSummary, MAX_CATALOG_ITEMS } from "../../contract";
import { commandId, commandKind, type PiCommandRef } from "./command-ids";
import { HOST_COMMAND } from "./host/protocol";
import { rowText } from "./phone-text";
import type { PiCommand } from "./rpc/replies";

const SKILL_PREFIX = "skill:";

function byName(a: { name: string }, b: { name: string }): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Templates, then skills, then extension commands, each by name. A template or skill an extension command of the same
 * name hides is left out: `prompt` runs the extension command first (`dist/core/agent-session.js:1702-1711`). The
 * bridge's own command (`host/protocol.ts`) is no command of the user's.
 */
export function commandSummaries(commands: readonly PiCommand[]): CommandSummary[] {
	const extensions = commands.filter((command) => command.source === "extension" && command.name !== HOST_COMMAND);
	const shadowed = new Set(extensions.map((command) => command.name));
	const visible = commands.filter((command) => command.source === "extension" || !shadowed.has(command.name));
	const of = (source: PiCommand["source"]) => visible.filter((command) => command.source === source).sort(byName);
	return [...of("prompt"), ...of("skill"), ...extensions.sort(byName)]
		.flatMap((command) => summaryOf(command))
		.slice(0, MAX_CATALOG_ITEMS);
}

function summaryOf(command: PiCommand): CommandSummary[] {
	const ref = refOf(command);
	const id = ref === undefined ? undefined : commandId(ref);
	if (ref === undefined || id === undefined) return [];
	const description = rowText(command.description);
	return [{ id, name: ref.name, kind: commandKind(ref.source), ...(description !== "" && { description }) }];
}

function refOf(command: PiCommand): PiCommandRef | undefined {
	switch (command.source) {
		case "extension":
			return { source: "extension", name: command.name };
		case "prompt":
			return { source: "template", name: command.name };
		case "skill":
			return command.name.startsWith(SKILL_PREFIX)
				? { source: "skill", name: command.name.slice(SKILL_PREFIX.length) }
				: undefined;
	}
}

/** Whether `ref` is a command `commands` names, and `prompt` would run as that command. */
export function offersCommand(commands: readonly PiCommand[], ref: PiCommandRef): boolean {
	return commandSummaries(commands).some((summary) => commandId(ref) === summary.id);
}
