import { phoneName } from "../../../adapter-kit/phone-text";
import { type CommandSummary, MAX_CATALOG_ITEMS, MAX_ID_CHARS } from "../../../contract";
import type { AvailableCommand } from "../acp/frames";

/**
 * The slash commands agy announced, by name, which is also the id: a command runs as the prompt `/<name> <input>`, so a
 * name with whitespace in it could not be sent back.
 */
export function commandSummaries(commands: readonly AvailableCommand[]): CommandSummary[] {
	const seen = new Set<string>();
	return commands
		.flatMap((command): CommandSummary[] => {
			const { name } = command;
			if (name === "" || /\s/.test(name) || name.length > MAX_ID_CHARS || seen.has(name)) return [];
			seen.add(name);
			const description = phoneName(command.description ?? "");
			const hint = phoneName(command.input?.hint ?? "");
			return [
				{
					id: name,
					name: phoneName(name) || name,
					kind: "command",
					...(description !== "" && { description }),
					...(hint !== "" && { argumentHint: hint }),
				},
			];
		})
		.slice(0, MAX_CATALOG_ITEMS);
}
